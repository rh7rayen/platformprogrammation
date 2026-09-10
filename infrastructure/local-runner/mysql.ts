// Trusted runtime metadata. SQL never becomes a host command or server option.
// Initialization completes before /work/query.sql is read by the limited client.
export const MYSQL_PROFILE = Object.freeze({
  memoryBytes: 1_073_741_824,
  tmpfsBytes: 536_870_912,
  initializationTimeoutMs: 90_000,
  runTimeoutMs: 5_000,
  exclusive: true,
});

export const mysqlRuntime = {
  id: 'mysql' as const,
  version: 'MySQL Community 8.4',
  image: 'uniexam/mysql:8.4-v1',
  filename: 'query.sql',
  build: 'mysql',
  profile: 'mysql' as const,
  initialize: ['/usr/local/bin/uniexam-mysql-init'],
  run: ['/usr/local/bin/uniexam-mysql-run'],
  sample: "SELECT 'Bonjour!';",
};
