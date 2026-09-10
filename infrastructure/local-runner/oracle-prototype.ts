import {randomUUID} from 'node:crypto';
import {dockerCommand, type CommandResult} from './docker-cli.js';

// This opt-in probe is independent from the application and runtime availability
// manifest. It never pulls an image, publishes a port or enables Oracle in the UI.
const OFFICIAL_IMAGE = 'container-registry.oracle.com/database/free@sha256:770ca58ab319d8cfde610b0db25c06899ce0af9591c4addfa10d2cb8f0318e65';
const action = process.argv[2];
if (process.argv.length !== 3 || action !== '--inspect') {
  throw new Error('Usage : oracle-prototype.ts --inspect (image préparée séparément ; aucun démarrage de base).');
}
const command = dockerCommand();
const name = `uniexam-oracle-probe-${randomUUID()}`;
const report: Record<string, unknown> = {engine: 'Oracle Database Free Lite', action, status: 'SKIPPED', executionVerified: false};
let created = false;
const remove = async () => {
  const result = await command(['rm', '--force', name], {timeoutMs: 10_000});
  if (result.code !== 0 && !/No such container/i.test(result.stderr)) throw new Error('Nettoyage du prototype Oracle non confirmé.');
};
const successful = (result: CommandResult) => result.code === 0 && !result.timedOut && !result.overflow;
const cleanOutput = (value: string) => value.split('\n').filter(line => !/ORACLE PASSWORD|GENERATED.*PASSWORD|password is/i.test(line)).join('\n');
process.once('SIGINT', () => {void remove().finally(() => process.exit(130));});
process.once('SIGTERM', () => {void remove().finally(() => process.exit(143));});

try {
  const image = await command(['image', 'inspect', '--format', '{{.Id}}', OFFICIAL_IMAGE]);
  if (!successful(image) || !/^sha256:[0-9a-f]{64}$/.test(image.stdout.trim())) {
    report.reason = 'Image absente : préparer explicitement l’image avant cet essai. Aucun pull automatique.';
    process.exitCode = 2;
  } else {
    const imageId = image.stdout.trim();
    report.imageId = imageId;
    const memory = 268_435_456;
    const tmpfs = 67_108_864;
    const shm = 16_777_216;
    const args = ['run', '--detach', '--rm', '--pull', 'never', '--name', name,
      '--label', 'uniexam.oracle-prototype=true', '--label', `uniexam.owner=${process.pid}`,
      '--log-driver', 'none', '--network', 'none', '--read-only', '--user', '54321:54321',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--pids-limit', '128',
      '--cpus', '1', '--memory', String(memory), '--memory-swap', String(memory),
      '--shm-size', String(shm), '--ulimit', 'nofile=1024:1024',
      '--tmpfs', `/tmp:rw,exec,nosuid,nodev,size=${tmpfs},mode=1777`, '--workdir', '/tmp',
      '--entrypoint', 'sleep', imageId, '300'];
    created = true;
    const start = await command(args, {timeoutMs: 15_000, onAbort: remove});
    if (!successful(start)) throw new Error(`Création refusée : ${cleanOutput(start.stderr)}`);
    const inspect = await command(['inspect', '--format', '{{json .HostConfig}}|{{json .Config.User}}|{{json .Mounts}}', name]);
    if (!successful(inspect)) throw new Error('Inspection Docker impossible.');
    const [hostText, userText, mountsText] = inspect.stdout.trim().split('|');
    const host = JSON.parse(hostText), user = JSON.parse(userText), mounts = JSON.parse(mountsText);
    if (host.Privileged || !host.ReadonlyRootfs || host.NetworkMode !== 'none' || user !== '54321:54321'
      || host.Memory !== memory || host.MemorySwap !== memory || host.ShmSize !== shm
      || host.PidsLimit !== 128 || host.NanoCpus !== 1_000_000_000 || host.LogConfig?.Type !== 'none'
      || !host.CapDrop?.some((cap: string) => cap.toUpperCase() === 'ALL')
      || !host.SecurityOpt?.some((opt: string) => /^no-new-privileges(?::true)?$/.test(opt))
      || !host.Tmpfs?.['/tmp']?.split(',').includes(`size=${tmpfs}`)
      || mounts.some((mount: {Type: string; Destination: string}) => mount.Type !== 'tmpfs' || mount.Destination !== '/tmp')) {
      throw new Error('La politique d’isolation réelle ne correspond pas au prototype.');
    }
    report.policyVerified = true;
    report.limits = {memory, tmpfs, shm, cpus: 1, network: 'none', rootReadonly: true};
    const exec = (argv: string[], timeoutMs: number, userId = '54321:54321', input = '') => command(
      ['exec', '--interactive', '--user', userId, '--workdir', '/tmp', name, ...argv],
      {timeoutMs, input, outputLimit: 32_768, onAbort: remove},
    );
    const result = await exec(['/bin/bash', '-c',
        "id; du -sk /opt/oracle/tmp_oradata /opt/oracle/product/26ai/dbhomeFree; find /opt/oracle/tmp_oradata -type f -name '*.gz' -exec gzip -l '{}' +; ls -ld /opt/oracle/oradata /opt/oracle/product/26ai/dbhomeFree/dbs; cat /opt/oracle/runOracle_lite.sh; cat /opt/oracle/oracle-free-26ai"], 15_000);
    report.status = successful(result) ? 'INSPECTED' : 'FAILED';
    report.inventory = cleanOutput(result.stdout);
    report.stderr = cleanOutput(result.stderr);
    process.exitCode = successful(result) ? 0 : 1;
    if (successful(result)) {
      const total = result.stdout.match(/^\s*\d+\s+(\d+)\s+[^\n]*\(totals\)\s*$/m);
      if (!total) throw new Error('La taille des données Oracle ne peut pas être confirmée.');
      const prebuiltLogicalBytes = Number(total[1]);
      const allowedDatabaseTmpfsBytes = 2_147_483_648;
      report.storage = {prebuiltLogicalBytes, allowedDatabaseTmpfsBytes, includesStudentPdb: false};
      if (prebuiltLogicalBytes > allowedDatabaseTmpfsBytes) {
        report.status = 'RESOURCE_BLOCKED';
        report.reason = 'Les données préconstruites dépassent le tmpfs de 2 Gio, avant la création de FREEPDB1. Aucune base démarrée.';
        process.exitCode = 2;
      }
    }
  }
} catch (error) {
  report.status = 'FAILED';
  report.reason = (error as Error).message;
  process.exitCode = 1;
} finally {
  if (created) {
    try {await remove(); report.cleaned = true;}
    catch (error) {report.status = 'FAILED'; report.cleanupError = (error as Error).message; process.exitCode = 1;}
  }
  console.log(JSON.stringify(report, null, 2));
}
