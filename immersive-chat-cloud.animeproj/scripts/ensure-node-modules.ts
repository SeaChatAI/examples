/**
 * Guard against hybrid link-deps leaving broken Vite cache symlinks.
 * Symptom: blank white screen + ENOENT on node_modules/.vite/deps_temp_*.
 *
 * Prefer: rm -rf node_modules && bun install
 * This only peels bad cache links so `bun run dev` recovers without a full reinstall.
 */
import { existsSync, lstatSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');

function unlinkCacheSymlink(rel: string): void {
  const path = join(nm, rel);
  try {
    const st = lstatSync(path);
    if (!st.isSymbolicLink()) return;
    // Always drop cache/bin symlinks from hybrid installs — Vite must own a real dir.
    rmSync(path, { force: true });
    console.log(`[ensure-node-modules] removed hybrid symlink node_modules/${rel}`);
  } catch {
    /* absent is fine */
  }
}

if (!existsSync(nm)) {
  console.error(
    'node_modules missing. Run: bun install && bun run dev\n' +
      '(do not use dev:hybrid unless sibling immersive-chat is installed)',
  );
  process.exit(1);
}

for (const name of ['.vite', '.vite-temp', '.bin']) {
  unlinkCacheSymlink(name);
}
