'use strict';

/**
 * Dev orchestrator — the whole app runs on ONE port (PORT in .env, default 4321).
 *
 *   1. Express API + static UI  — `node --watch`, restarts when server/ changes
 *   2. Astro rebuild watcher    — reruns `astro build` when src/, public/ or the
 *                                 Astro config change (Astro 7 has no `build --watch`)
 *
 * The page polls /__buildid and reloads itself after a rebuild, so there is no
 * second port and no manual browser refresh.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const WATCH_TARGETS = ['src', 'public', 'astro.config.mjs'];
const REBUILD_DELAY_MS = 350;

const children = [];
const watchers = [];
let shuttingDown = false;
let building = false;
let buildQueued = false;
let buildCount = 0;
let rebuildTimer = null;

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

function runBuild(reason) {
  if (shuttingDown) return;
  if (building) {
    buildQueued = true;
    return;
  }

  const entry = astroEntry();
  if (!entry) {
    console.error('[dev] Astro is not installed. Run: npm install');
    shutdown(1);
    return;
  }

  building = true;
  const started = Date.now();
  const child = spawn(process.execPath, [entry, 'build'], { cwd: root, stdio: 'inherit' });

  const finish = (code) => {
    building = false;
    if (code === 0) {
      buildCount += 1;
      console.log(`[dev] build #${buildCount} ok in ${Date.now() - started}ms (${reason})`);
    } else {
      console.error(`[dev] build FAILED (exit ${code}) — ${reason}`);
    }
    if (buildQueued && !shuttingDown) {
      buildQueued = false;
      runBuild('queued change');
    }
  };

  child.on('exit', (code) => finish(code ?? 1));
  child.on('error', (err) => {
    console.error('[dev] could not run astro build:', err.message);
    finish(1);
  });
}

function scheduleBuild(reason) {
  if (shuttingDown) return;
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => runBuild(reason), REBUILD_DELAY_MS);
}

function watchSources() {
  for (const target of WATCH_TARGETS) {
    const full = path.join(root, target);
    if (!fs.existsSync(full)) continue;
    try {
      const watcher = fs.watch(full, { recursive: true }, (_event, filename) => {
        scheduleBuild(filename ? `${target}/${filename}` : target);
      });
      watcher.on('error', (err) => console.error(`[dev] watcher error (${target}): ${err.message}`));
      watchers.push(watcher);
    } catch (err) {
      console.error(`[dev] could not watch ${target}: ${err.message}`);
    }
  }
  console.log(`[dev] watching ${WATCH_TARGETS.join(', ')} for changes`);
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(rebuildTimer);
  for (const watcher of watchers) {
    try {
      watcher.close();
    } catch {
      /* already closed */
    }
  }
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

if (!astroEntry()) {
  console.error('[dev] Astro is not installed. Run: npm install');
  process.exit(1);
}

console.log('[dev] API + UI on one port (see PORT in .env) — building the interface…');
start('api', process.execPath, ['--watch', '--watch-path=server', path.join('server', 'index.js')]);
runBuild('initial');
watchSources();
