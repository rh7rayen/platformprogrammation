import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mysqlRuntime, MYSQL_PROFILE} from '../mysql.js';
import {executionPolicy} from '../engine.js';

test('MySQL initialization is a trusted separate step with a bounded exclusive profile', () => {
  assert.deepEqual(mysqlRuntime.initialize, ['/usr/local/bin/uniexam-mysql-init']);
  assert.deepEqual(mysqlRuntime.run, ['/usr/local/bin/uniexam-mysql-run']);
  assert.equal(mysqlRuntime.filename, 'query.sql');
  assert.equal(MYSQL_PROFILE.exclusive, true);
  assert.equal(MYSQL_PROFILE.memoryBytes, 1024 ** 3);
  assert.equal(MYSQL_PROFILE.tmpfsBytes, 512 * 1024 ** 2);
  assert.equal(MYSQL_PROFILE.initializationTimeoutMs, 90_000);
  assert.equal(MYSQL_PROFILE.runTimeoutMs, 5_000);
  assert.deepEqual(executionPolicy(mysqlRuntime), {
    memory: MYSQL_PROFILE.memoryBytes,
    tmpfs: MYSQL_PROFILE.tmpfsBytes,
    exclusive: MYSQL_PROFILE.exclusive,
    initializationMs: MYSQL_PROFILE.initializationTimeoutMs,
  });
});

test('MySQL scripts keep source out of initialization and client shell commands disabled', async () => {
  const init = await readFile(new URL('../images/mysql/uniexam-mysql-init', import.meta.url), 'utf8');
  const run = await readFile(new URL('../images/mysql/uniexam-mysql-run', import.meta.url), 'utf8');
  const dockerfile = await readFile(new URL('../images/mysql/Dockerfile', import.meta.url), 'utf8');
  assert.ok(!init.includes('/work/'));
  assert.match(init, /--skip-networking/);
  assert.match(init, /--secure-file-priv=NULL/);
  assert.match(init, /--local-infile=0/);
  const grants = init.split('\n').filter(line => line.startsWith('GRANT '));
  assert.equal(grants.length, 1);
  assert.match(grants[0], /ON exam\.\* TO 'student'@'localhost';$/);
  assert.doesNotMatch(grants[0], /\b(?:FILE|SUPER|GRANT OPTION|SYSTEM_USER|CREATE USER|EVENT)\b/);
  assert.match(run, /--binary-mode/);
  assert.match(run, /--local-infile=0/);
  assert.match(run, /< \/work\/query\.sql/);
  assert.match(dockerfile, /FROM scratch\nCOPY --from=upstream \/ \//);
  assert.doesNotMatch(dockerfile, /^VOLUME\b/m);
});
