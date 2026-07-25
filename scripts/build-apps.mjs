#!/usr/bin/env node
/**
 * Resolves every hosted manifest into dist/a/<slug>/.
 *
 *   in-repo       files committed under apps/<slug>/, optionally built in place
 *   source-build  clone a GitHub repo at a pinned ref and run its build
 *   artifact      download prebuilt output from a release asset or a branch
 *
 * redirect / proxy / link produce no files; they are routing only.
 *
 * A failing app is isolated: it gets a placeholder page and the run continues,
 * so one broken toy can never block everyone else's deploy. Pass --strict to
 * fail the process instead (used by PR validation).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { DIST, ROOT, isHosted, loadApps, loadSite, validateAll } from './registry.mjs';

const STRICT = process.argv.includes('--strict');
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const TMP = join(ROOT, '.tmp');
const OUT_ROOT = join(DIST, 'a');

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function shell(command, cwd) {
  const isWin = process.platform === 'win32';
  const file = isWin ? process.env.ComSpec || 'cmd.exe' : '/bin/sh';
  const args = isWin ? ['/d', '/s', '/c', command] : ['-c', command];
  return execFileSync(file, args, { cwd, stdio: 'inherit', windowsVerbatimArguments: isWin });
}

/** Keeps build.output from escaping the checkout via ".." or an absolute path. */
function safeJoin(base, child) {
  const target = resolve(base, child || '.');
  const rel = relative(base, target);
  if (rel.startsWith('..') || (rel.split(sep)[0] === '..')) {
    throw new Error(`output "${child}" escapes the checkout directory`);
  }
  return target;
}

function fetchRepo(repo, ref, dest) {
  const url = `https://github.com/${repo}.git`;
  mkdirSync(dest, { recursive: true });
  const isSha = /^[0-9a-f]{40}$/.test(ref || '');
  if (isSha) {
    run('git', ['init', '--quiet'], { cwd: dest });
    run('git', ['remote', 'add', 'origin', url], { cwd: dest });
    run('git', ['fetch', '--quiet', '--depth', '1', 'origin', ref], { cwd: dest });
    run('git', ['checkout', '--quiet', 'FETCH_HEAD'], { cwd: dest });
  } else {
    const args = ['clone', '--quiet', '--depth', '1'];
    if (ref) args.push('--branch', ref);
    args.push(url, dest);
    run('git', args);
  }
}

function unzip(zip, dest) {
  mkdirSync(dest, { recursive: true });
  try {
    run('unzip', ['-q', '-o', zip, '-d', dest]);
  } catch {
    // bsdtar (Windows 10+, macOS) reads zip archives; GNU tar does not.
    run('tar', ['-xf', zip, '-C', dest]);
  }
}

function download(url, dest) {
  run('curl', ['-fsSL', '--retry', '3', '-o', dest, url]);
}

function isEmptyDir(dir) {
  return !existsSync(dir) || !statSync(dir).isDirectory() || readdirSync(dir).length === 0;
}

function assertHasIndex(dir, app) {
  if (!existsSync(join(dir, 'index.html'))) {
    throw new Error(`build output has no index.html (looked in ${app.build?.output ?? '.'})`);
  }
}

const EXCLUDED = new Set(['.git', '.github', 'node_modules', '.vscode', '.idea']);

function isExcluded(src, from) {
  const rel = relative(from, src);
  if (!rel) return false;
  return rel.split(sep).some((part) => EXCLUDED.has(part) || part.startsWith('.env'));
}

function copyOut(from, slug) {
  const to = join(OUT_ROOT, slug);
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  cpSync(from, to, {
    recursive: true,
    filter: (src) => !isExcluded(src, from),
  });
  return to;
}

function buildInRepo(app) {
  const src = join(ROOT, 'apps', app.slug);
  if (isEmptyDir(src)) throw new Error(`apps/${app.slug}/ is missing or empty`);
  if (app.build?.install) shell(app.build.install, src);
  if (app.build?.command) shell(app.build.command, src);
  const out = safeJoin(src, app.build?.output ?? '.');
  assertHasIndex(out, app);
  return copyOut(out, app.slug);
}

function buildFromSource(app) {
  const work = join(TMP, app.slug);
  rmSync(work, { recursive: true, force: true });
  fetchRepo(app.build.repo, app.build.ref, work);
  if (app.build.install) shell(app.build.install, work);
  shell(app.build.command, work);
  const out = safeJoin(work, app.build.output ?? '.');
  assertHasIndex(out, app);
  return copyOut(out, app.slug);
}

function buildFromArtifact(app) {
  const work = join(TMP, app.slug);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  if (app.build.artifact === 'branch') {
    fetchRepo(app.build.repo, app.build.branch, work);
    const out = safeJoin(work, app.build.output ?? '.');
    assertHasIndex(out, app);
    return copyOut(out, app.slug);
  }

  const tag = app.build.release && app.build.release !== 'latest'
    ? `download/${app.build.release}`
    : 'latest/download';
  const url = `https://github.com/${app.build.repo}/releases/${tag}/${app.build.asset}`;
  const zip = join(work, '_asset.zip');
  download(url, zip);
  const extracted = join(work, 'unpacked');
  unzip(zip, extracted);

  // Release zips commonly wrap everything in a single top-level folder.
  let root = safeJoin(extracted, app.build.output ?? '.');
  if (!existsSync(join(root, 'index.html'))) {
    const entries = readdirSync(root, { withFileTypes: true }).filter((e) => !e.name.startsWith('_'));
    if (entries.length === 1 && entries[0].isDirectory()) root = join(root, entries[0].name);
  }
  assertHasIndex(root, app);
  return copyOut(root, app.slug);
}

function placeholder(app, message) {
  const dir = join(OUT_ROOT, app.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${app.name} is between takes</title>
<link rel="stylesheet" href="/assets/style.css"></head>
<body><div class="oops">
<h1>between takes</h1>
<p><code>${app.slug}</code> did not build on the last deploy.</p>
<a class="cta" href="https://stuntcamp.app/">back to the camp</a>
</div></body></html>
`, 'utf8');
  writeFileSync(join(dir, '_build-error.txt'), `${message}\n`, 'utf8');
}

function countFiles(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(join(dir, e.name)) : 1;
  }
  return n;
}

function main() {
  const site = loadSite();
  const all = loadApps();

  const { errors } = validateAll(all, site);
  if (errors.length) {
    for (const e of errors) console.error(`error ${e}`);
    throw new Error('registry is invalid; refusing to build apps');
  }

  let apps = all.filter((a) => a.visible !== false).filter(isHosted);
  if (ONLY) apps = apps.filter((a) => a.slug === ONLY);

  mkdirSync(OUT_ROOT, { recursive: true });
  const report = [];

  for (const app of apps) {
    const started = Date.now();
    process.stdout.write(`\n--- ${app.slug} (${app.type}) ---\n`);
    try {
      const out = app.type === 'in-repo' ? buildInRepo(app)
        : app.type === 'source-build' ? buildFromSource(app)
          : buildFromArtifact(app);
      const files = countFiles(out);
      report.push({ slug: app.slug, type: app.type, ok: true, files, ms: Date.now() - started });
      console.log(`ok    ${app.slug} -> dist/a/${app.slug}/ (${files} file(s))`);
    } catch (err) {
      const message = err?.message || String(err);
      report.push({ slug: app.slug, type: app.type, ok: false, error: message });
      console.error(`FAIL  ${app.slug}: ${message}`);
      placeholder(app, message);
    }
  }

  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  writeFileSync(join(DIST, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const failed = report.filter((r) => !r.ok);
  console.log(`\napps  ${report.length - failed.length}/${report.length} built`);
  if (failed.length && STRICT) {
    throw new Error(`${failed.length} app(s) failed to build: ${failed.map((f) => f.slug).join(', ')}`);
  }
}

main();
