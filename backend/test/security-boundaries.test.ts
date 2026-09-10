import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { POST } from '../../frontend/src/app/api/[...path]/route';
import { readLimitedText, RequestBodyError } from '../../frontend/src/lib/server-request-body';
import { DataDirectoryLock } from '../src/database/data-directory-lock';
import { AuthController } from '../src/auth/auth.controller';
import { AuthGuard } from '../src/auth/auth.guard';
import type { AuthService } from '../src/auth/auth.service';
import { HttpException, type ExecutionContext } from '@nestjs/common';

function streaming(chunks: Uint8Array[], options: { declared?: string } = {}) {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { const chunk = chunks.shift(); if (chunk) controller.enqueue(chunk); else controller.close(); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const request = new Request('http://localhost/body', {
    method: 'POST', body, duplex: 'half',
    headers: options.declared === undefined ? undefined : { 'Content-Length': options.declared },
  } as RequestInit);
  return { request, cancelled: () => cancelled };
}

test('BFF rejects oversized chunked bodies while reading and cancels their stream', async () => {
  const { request, cancelled } = streaming([new Uint8Array(4), new Uint8Array(5), new Uint8Array(100_000)]);
  await assert.rejects(readLimitedText(request, 8), (error: unknown) => error instanceof RequestBodyError && error.status === 413);
  assert.equal(cancelled(), true);
});

test('BFF checks declared size early and handles UTF-8 byte boundaries', async () => {
  const oversized = streaming([new Uint8Array(1)], { declared: '65537' });
  await assert.rejects(readLimitedText(oversized.request), (error: unknown) => error instanceof RequestBodyError && error.status === 413);
  assert.equal(oversized.cancelled(), true);
  const unicode = new TextEncoder().encode('é€');
  assert.equal(await readLimitedText(streaming([unicode.slice(0, 1), unicode.slice(1)]).request, 5), 'é€');
  await assert.rejects(readLimitedText(streaming([new Uint8Array([0xff])]).request), (error: unknown) => error instanceof RequestBodyError && error.status === 400);
});

test('BFF stops an incomplete request after the bounded read deadline', async () => {
  let cancelled = false;
  const request = new Request('http://localhost/body', {
    method: 'POST', body: new ReadableStream({ cancel() { cancelled = true; } }), duplex: 'half',
  } as RequestInit);
  await assert.rejects(readLimitedText(request, 64, 15), (error: unknown) => error instanceof RequestBodyError && error.status === 408);
  assert.equal(cancelled, true);
});

test('BFF rejects cross-origin mutation before forwarding anything', async t => {
  const upstream = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not be reached'); });
  const response = await POST(new NextRequest('http://localhost:3000/api/auth/demo', {
    method: 'POST', headers: { Origin: 'https://foreign.example' }, body: '{}',
  }), { params: Promise.resolve({ path: ['auth', 'demo'] }) });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(upstream.mock.callCount(), 0);
});

test('BFF keeps session token in HttpOnly cookie and never follows API redirects', async t => {
  const token = 'a'.repeat(64);
  const upstream = t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, _options?: RequestInit) => Response.json({ access_token: token, expires_in: 3600 }));
  const response = await POST(new NextRequest('http://localhost:3000/api/auth/demo', {
    method: 'POST', headers: { Origin: 'http://localhost:3000' }, body: '{}',
  }), { params: Promise.resolve({ path: ['auth', 'demo'] }) });
  assert.deepEqual(await response.json(), { authenticated: true });
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=strict/i);
  assert.equal(upstream.mock.calls[0].arguments[1]?.redirect, 'error');
});

test('BFF discards malformed session responses instead of creating a session cookie', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ access_token: 'short', expires_in: -1 }));
  const response = await POST(new NextRequest('http://localhost:3000/api/auth/demo', {
    method: 'POST', headers: { Origin: 'http://localhost:3000' }, body: '{}',
  }), { params: Promise.resolve({ path: ['auth', 'demo'] }) });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('set-cookie'), null);
});

function temporaryDirectory(t: { after: (cleanup: () => void) => void }) {
  const directory = mkdtempSync(path.join(tmpdir(), 'uniexam-lock-test-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('uniexam-lock-test-'));
    rmSync(resolved, { recursive: true, force: true });
  });
  return directory;
}

test('embedded database lock excludes a second owner and releases only after close', t => {
  const directory = temporaryDirectory(t);
  const owner = new DataDirectoryLock(directory);
  assert.throws(() => new DataDirectoryLock(path.join(directory, '.')), /déjà verrouillée/);
  assert.equal(JSON.parse(readFileSync(owner.lockPath, 'utf8')).pid, process.pid);
  owner.release();
  owner.release();
  const nextOwner = new DataDirectoryLock(directory);
  nextOwner.release();
  assert.equal(existsSync(owner.lockPath), false);
});

test('embedded database lock never removes a changed ownership file', t => {
  const directory = temporaryDirectory(t);
  const owner = new DataDirectoryLock(directory);
  writeFileSync(owner.lockPath, JSON.stringify({ nonce: 'another-owner' }));
  assert.throws(() => owner.release(), /propriétaire/);
  assert.equal(existsSync(owner.lockPath), true);
});

test('login quota follows the validated account and keeps another account available', async () => {
  const controller = new AuthController({ login: async (email: string) => ({ email }) } as unknown as AuthService);
  for (let i = 0; i < 30; i++) await controller.login({ email: 'student.one@example.test', password: 'example-password' });
  assert.throws(() => controller.login({ email: 'STUDENT.ONE@example.test', password: 'example-password' }),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 429);
  assert.deepEqual(await controller.login({ email: 'student.two@example.test', password: 'example-password' }), { email: 'student.two@example.test' });
});

test('write quota follows authenticated actor across tokens instead of the shared BFF IP', async () => {
  const guard = new AuthGuard({ authenticate: async (token: string) => token.startsWith('student-two') ? 'student-two' : 'student-one' } as AuthService);
  const context = (token: string, method = 'PUT') => ({ switchToHttp: () => ({ getRequest: () => ({ method, ip: '127.0.0.1', headers: { authorization: `Bearer ${token}` } }) }) }) as unknown as ExecutionContext;
  for (let i = 0; i < 120; i++) {
    assert.equal(await guard.canActivate(context('student-one-session')), true);
    assert.equal(await guard.canActivate(context('student-two-session')), true);
  }
  await assert.rejects(guard.canActivate(context('student-one-another-session')),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 429);
  assert.equal(await guard.canActivate(context('student-two-session', 'GET')), true);
});
