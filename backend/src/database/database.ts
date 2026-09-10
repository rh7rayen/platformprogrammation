import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config';
import { databaseTls } from '../config';
import { DataDirectoryLock } from './data-directory-lock';

export interface QueryResult<T> { rows: T[] }
export interface SqlClient { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> }
const localAuthBoundary = `
  create schema if not exists auth;
  create table if not exists auth.users(id uuid primary key, email text not null unique);
  do $$ begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; end $$;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
  $$;
  grant usage on schema auth,public to authenticated;
  grant execute on function auth.uid() to authenticated;
`;

export class Database {
  private local?: PGlite;
  private pool?: Pool;
  private directoryLock?: DataDirectoryLock;
  private connecting = false;
  private closing?: Promise<void>;
  constructor(readonly config: AppConfig) {}
  async connect(memory = false) {
    if(this.connecting || this.local || this.pool || this.closing) throw new Error('Database lifecycle already started');
    this.connecting = true;
    try {
    if (this.config.APP_MODE === 'demo') {
      const directory = path.resolve(this.config.root, this.config.DEMO_DATA_DIR);
      if (!memory) {
        mkdirSync(directory, { recursive: true });
        this.directoryLock = new DataDirectoryLock(directory);
      }
      this.local = await PGlite.create(memory ? undefined : directory);
      await this.local.exec(localAuthBoundary);
      await this.migrate();
    } else {
      this.pool = new Pool({ connectionString: this.config.DATABASE_URL, ssl: databaseTls(this.config), max: 10, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
      await this.pool.query('select 1');
    }
    } catch(error) {
      await this.close();
      throw error;
    } finally { this.connecting = false; }
  }
  async close() {
    if(!this.closing)this.closing=(async()=>{
      await this.local?.close();
      await this.pool?.end();
      this.directoryLock?.release();
    })();
    return this.closing;
  }
  async privileged<T>(work: (client: SqlClient) => Promise<T>): Promise<T> {
    if (this.local) return this.local.transaction(tx => work(tx as SqlClient));
    if (!this.pool) throw new Error('Database unavailable');
    const client = await this.pool.connect();
    try { await client.query('begin'); const result = await work(client as SqlClient); await client.query('commit'); return result; }
    catch (error) { await client.query('rollback'); throw error; }
    finally { client.release(); }
  }
  async asUser<T>(userId: string, work: (client: SqlClient) => Promise<T>): Promise<T> {
    return this.privileged(async client => {
      await client.query("select set_config('request.jwt.claim.sub',$1,true), set_config('statement_timeout','10000',true)", [userId]);
      await client.query('set local role uniexam_api');
      return work(client);
    });
  }
  async migrate() {
    const directory = path.join(this.config.root, 'backend/src/database/migrations');
    await this.privileged(async client => {
      // PostgreSQL serializes concurrent deploy migrations. PGlite is single-process.
      if (this.pool) await client.query('select pg_advisory_xact_lock(81461702)');
      await client.query('create schema if not exists private');
      await client.query('create table if not exists private.schema_migrations(name text primary key, applied_at timestamptz not null default now())');
      for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
        const found = await client.query('select name from private.schema_migrations where name=$1', [name]);
        if (!found.rows.length) {
          // Migrations contain multiple statements, with no user input.
          const sql = readFileSync(path.join(directory, name), 'utf8');
          if (this.local) await (client as unknown as { exec(sql: string): Promise<unknown> }).exec(sql);
          else await client.query(sql);
          await client.query('insert into private.schema_migrations(name) values($1)', [name]);
        }
      }
    });
  }
}
