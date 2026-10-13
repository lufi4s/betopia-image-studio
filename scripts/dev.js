'use strict';

/**
 * Dev orchestrator: runs the Express API (--watch) and the Astro dev server
 * together, and shuts both down when either one exits.
 *
 *   API  → http://localhost:3000
 *   Web  → http://localhost:4321  (proxies /api and /images to the API)
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const children = [];
let shuttingDown = false;

function astroEntry() {
  const pkgPath = path.join(root, 'node_modules', 'astro', 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin && pkg.bin.astro;
    return bin ? path.join(path.dirname(pkgPath), bin) : null;
  } catch {
    return null;
  }
}

function start(name, command, args) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.log(`\n[dev] ${name} exited (${signal || code}) — stopping the rest.`);
    shutdown(code ?? 1);
  });
  child.on('error', (err) => {
    console.error(`[dev] failed to start ${name}:`, err.message);
    shutdown(1);
  });
  children.push(child);
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const entry = astroEntry();
if (!entry) {
  console.error('[dev] Astro is not installed. Run: npm install');
  process.exit(1);
}

console.log('[dev] starting API (watch) on :3000 and Astro dev on :4321 …');
start('api', process.execPath, ['--watch', '--watch-path=server', path.join('server', 'index.js')]);
start('astro', process.execPath, [entry, 'dev']);
