import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DockerEngine} from '../engine.js';
import {mysqlRuntime} from '../mysql.js';

// Opt-in only: every case starts a real fresh, isolated MySQL database. This must
// run after the trusted image build and when the machine has no other DB job.
// node --import tsx --test infrastructure/local-runner/test/mysql-live.test.ts
// with UNIEXAM_TEST_MYSQL=1; no application database or runner API token is used.
test('real MySQL: SQL, routines, isolation, time limit and privilege boundaries', {
  skip: process.env.UNIEXAM_TEST_MYSQL !== '1',
  timeout: 15 * 60_000,
}, async t => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'uniexam-mysql-live-'));
  const engine = new DockerEngine(undefined, dataRoot);
  await engine.init();
  try {
    assert.equal(await engine.health(), true, 'Docker Linux doit être démarré.');
    const image = await engine.inspect(mysqlRuntime.image);
    assert.ok(image, 'Construire préalablement l’image MySQL officielle ; absence != succès.');
    const execute = (source: string) => engine.execute(mysqlRuntime, source, '', image.imageId);
    const success = async (source: string, stdout: string | RegExp) => {
      const result = await execute(source);
      assert.equal(result.status, 'SUCCEEDED', JSON.stringify(result));
      if (typeof stdout === 'string') assert.equal(result.stdout.replaceAll('\r\n', '\n'), stdout);
      else assert.match(result.stdout, stdout);
      assert.deepEqual(await readdir(engine.jobsRoot), []);
      return result;
    };
    const denied = async (source: string, reason: RegExp) => {
      const result = await execute(source);
      assert.equal(result.status, 'RUNTIME_ERROR', JSON.stringify(result));
      assert.match(result.stderr, reason);
      assert.deepEqual(await readdir(engine.jobsRoot), []);
      return result;
    };
    await t.test('SELECT 42 runs on the real MySQL 8.4 server', async () => {
      await success('SELECT 42; SELECT VERSION();', /^42\r?\n8\.4\.[^\r\n]+\r?\n$/);
    });
    await t.test('DDL, DML and a stored routine work with DELIMITER', async () => {
      await success(`CREATE TABLE answers (value INT); INSERT INTO answers VALUES (42);
DELIMITER //
CREATE PROCEDURE answer() BEGIN SELECT value FROM answers; END //
DELIMITER ;
CALL answer();`, '42\n');
    });
    await t.test('a syntax error is reported by MySQL', async () => {
      await denied('SELEC 42;', /ERROR 1064/);
    });
    await t.test('tables from an earlier execution cannot be read', async () => {
      await denied('SELECT * FROM answers;', /ERROR 1146/);
    });
    await t.test('the student cannot inspect server account credentials', async () => {
      await denied('SELECT User FROM mysql.user;', /ERROR 1142|denied/i);
    });
    await t.test('the student cannot grant global FILE privileges', async () => {
      await denied("GRANT FILE ON *.* TO 'student'@'localhost';", /ERROR 1044|ERROR 1045|ERROR 1227|denied/i);
    });
    await t.test('server-side file reads and writes are disabled', async () => {
      await success("SELECT LOAD_FILE('/etc/hostname') IS NULL;", '1\n');
      await denied("SELECT 42 INTO OUTFILE '/tmp/uniexam-synthetic-output';", /ERROR 1290|ERROR 1227|denied|secure-file-priv/i);
    });
    await t.test('LOCAL INFILE cannot read even the synthetic mounted SQL source', async () => {
      await denied("CREATE TABLE input_line (line TEXT); LOAD DATA LOCAL INFILE '/work/query.sql' INTO TABLE input_line;", /ERROR 3948|ERROR 2068|disabled|not allowed/i);
    });
    await t.test('mysql local shell and source commands are treated as invalid SQL', async () => {
      const shell = await denied("\\! printf 'UNIEXAM_SHELL_SHOULD_NOT_RUN'\nSELECT 42;", /ERROR|Unknown command/i);
      assert.equal(shell.stdout.includes('UNIEXAM_SHELL_SHOULD_NOT_RUN'), false);
      await denied('source /work/query.sql;\nSELECT 42;', /ERROR 1064|Unknown command/i);
    });
    await t.test('a bounded sleeping query times out and removes its database', async () => {
      const result = await execute('SELECT SLEEP(60);');
      assert.equal(result.status, 'TIME_LIMIT', JSON.stringify(result));
      assert.deepEqual(await readdir(engine.jobsRoot), []);
      assert.equal(engine.fatalCleanup, false);
    });
  } finally {
    await engine.stop();
    // Only this test's resolved own temporary directory can be removed.
    assert.equal(path.dirname(dataRoot), tmpdir());
    assert.match(path.basename(dataRoot), /^uniexam-mysql-live-/);
    await rm(dataRoot, {recursive: true, force: true});
  }
});
