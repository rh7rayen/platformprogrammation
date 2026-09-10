import { closeSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync, fsyncSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/** PGlite is embedded: two API processes must never open one data directory. */
export class DataDirectoryLock {
  private descriptor: number | undefined;
  private readonly nonce = randomUUID();
  readonly lockPath: string;

  constructor(directory: string) {
    // Resolve junctions/symlinks so alternate spellings share the same lock.
    this.lockPath = path.join(realpathSync(directory), '.uniexam-process.lock');
    try { this.descriptor = openSync(this.lockPath, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`La base locale est déjà verrouillée : ${this.lockPath}. Arrêtez proprement l’autre API. Après un arrêt forcé, vérifiez que son processus est arrêté avant de retirer uniquement ce verrou ; ne supprimez jamais la base.`);
      }
      throw error;
    }
    try {
      writeFileSync(this.descriptor, JSON.stringify({ pid: process.pid, nonce: this.nonce, createdAt: new Date().toISOString() }));
      fsyncSync(this.descriptor);
    } catch (error) {
      closeSync(this.descriptor);
      this.descriptor = undefined;
      unlinkSync(this.lockPath);
      throw error;
    }
  }

  /** Called only after PGlite has flushed and closed successfully. */
  release() {
    if (this.descriptor === undefined) return;
    closeSync(this.descriptor);
    this.descriptor = undefined;
    const owner = JSON.parse(readFileSync(this.lockPath, 'utf8')) as { nonce?: string };
    if (owner.nonce !== this.nonce) throw new Error('Le propriétaire du verrou de base locale a changé.');
    unlinkSync(this.lockPath);
  }
}
