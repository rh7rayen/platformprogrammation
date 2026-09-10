import { loadConfig } from '../config';
import { Database } from './database';
async function main() {
  const config = loadConfig();
  const database = new Database(config);
  try { await database.connect(); await database.migrate(); console.log('Migrations applied successfully.'); }
  finally { await database.close(); }
}
main().catch(() => { console.error('Migration failed. Check connection, privileges and migration compatibility.'); process.exitCode=1; });
