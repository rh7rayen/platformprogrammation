import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { config as dotenv } from 'dotenv';
import { z } from 'zod';

export function projectRoot() {
  if (process.env.PROJECT_ROOT) return path.resolve(process.env.PROJECT_ROOT);
  let current = process.cwd();
  while (!existsSync(path.join(current, 'packages/contracts/package.json'))) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error('Run the command inside the UniExam project.');
    current = parent;
  }
  return current;
}
const environmentSchema = z.object({
  APP_MODE: z.enum(['demo', 'supabase']).default('demo'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('127.0.0.1'),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  DATABASE_URL: z.string().default(''), DATABASE_SSL: z.enum(['true','false']).default('true'),
  DATABASE_CA_FILE: z.string().default(''),
  SUPABASE_URL: z.string().default(''), SUPABASE_PUBLISHABLE_KEY: z.string().default(''),
  DEMO_DATA_DIR: z.string().default('.data/uniexam'),
  AI_ENABLED: z.enum(['true','false']).default('false'),
  OPENAI_API_KEY: z.string().default(''), OPENAI_MODEL: z.string().default('gpt-4.1-mini-2025-04-14'),
  AI_DAILY_LIMIT: z.coerce.number().int().min(1).max(100).default(20),
  RUNNER_ENABLED:z.enum(['true','false']).default('false'),
  RUNNER_PROVIDER:z.enum(['judge0','docker']).default('judge0'),
  RUNNER_BASE_URL:z.string().default(''),RUNNER_AUTH_TOKEN:z.string().default(''),
  RUNNER_LANGUAGE_IDS:z.string().default('{}'),
  RECORDINGS_ENABLED:z.enum(['true','false']).default('false'),
  SUPABASE_SERVICE_ROLE_KEY:z.string().default(''),RECORDINGS_BUCKET:z.string().default('exam-recordings'),
  RECORDINGS_RETENTION_DAYS:z.coerce.number().int().min(1).max(365).default(30),
  EMAIL_ENABLED:z.enum(['true','false']).default('false'),
  RESEND_API_KEY:z.string().default(''),EMAIL_FROM:z.string().default(''),
  EMAIL_ENCRYPTION_KEY:z.string().default(''),
});
export type AppConfig = z.infer<typeof environmentSchema> & { root: string };
export function loadConfig(overrides: Record<string, unknown> = {}): AppConfig {
  const root = projectRoot();
  dotenv({ path: path.join(root, '.env'), quiet: true });
  const config = environmentSchema.parse({ ...process.env, ...overrides });
  if (config.APP_MODE === 'demo' && (config.NODE_ENV === 'production' || !['127.0.0.1', 'localhost', '::1'].includes(config.HOST))) {
    throw new Error('Demo authentication is restricted to development on loopback.');
  }
  if (config.APP_MODE === 'supabase' && (!config.DATABASE_URL || !config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error('Supabase requires DATABASE_URL, SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.');
  }
  if (config.NODE_ENV === 'production' && (config.DATABASE_SSL !== 'true' || !config.WEB_ORIGIN.startsWith('https://') || !config.SUPABASE_URL.startsWith('https://'))) {
    throw new Error('Production requires HTTPS and verified database TLS.');
  }
  return { ...config, root };
}
export function databaseTls(config: AppConfig) {
  return config.DATABASE_SSL === 'true' ? { rejectUnauthorized: true, ...(config.DATABASE_CA_FILE ? { ca: readFileSync(config.DATABASE_CA_FILE, 'utf8') } : {}) } : false;
}
