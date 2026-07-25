#!/usr/bin/env node
/**
 * Renders the stuntcamp index from the registry. Zero dependencies on purpose:
 * the hub is a static gallery, and nothing here should ever need updating.
 *
 * Outputs dist/index.html, dist/404.html, dist/apps.json and dist/assets/.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIST, ROOT, isHosted, loadApps, loadSite, publicUrl, validateAll } from '../scripts/registry.mjs';

const HUB = join(ROOT, 'hub');
const THUMBS = join(HUB, 'assets', 'thumbs');

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const HOST_LABEL = {
  'in-repo': { badge: 'hosted here', cls: 'here', meta: 'in the stuntcamp repo' },
  'source-build': { badge: 'hosted here', cls: 'here', meta: 'built from source' },
  artifact: { badge: 'hosted here', cls: 'here', meta: 'prebuilt upload' },
  redirect: { badge: 'lives elsewhere', cls: 'away', meta: 'external host' },
  proxy: { badge: 'lives elsewhere', cls: 'away', meta: 'external host' },
  link: { badge: 'repo only', cls: 'repo', meta: 'not a website' },
};

/** Auto-captured screenshots land in hub/assets/thumbs/<slug>.(webp|png). */
function findThumb(app) {
  if (app.thumbnail) return app.thumbnail;
  if (!existsSync(THUMBS)) return null;
  for (const ext of ['webp', 'png', 'jpg']) {
    if (existsSync(join(THUMBS, `${app.slug}.${ext}`))) return `assets/thumbs/${app.slug}.${ext}`;
  }
  return null;
}

function card(app, site) {
  const host = HOST_LABEL[app.type] ?? HOST_LABEL.link;
  const href = publicUrl(app, site);
  const thumb = findThumb(app);
  const accent = app.accent || '#8aa4c8';

  const shot = thumb
    ? `<img src="${esc(thumb)}" alt="Screenshot of ${esc(app.name)}" loading="lazy" decoding="async" width="800" height="500">`
    : `<span class="glyph" aria-hidden="true">${esc(app.name.slice(0, 2))}</span>`;

  const tags = (app.tags || []).length
    ? `<ul class="tags">${app.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
    : '';

  const note = app.note ? `<p class="note">${esc(app.note)}</p>` : '';

  const author = app.author
    ? (app.author.url
      ? `<a href="${esc(app.author.url)}" rel="noopener">${esc(app.author.name)}</a>`
      : esc(app.author.name))
    : '&mdash;';

  const source = app.source
    ? ` &middot; <a href="${esc(app.source)}" rel="noopener">source</a>`
    : '';

  return `<article class="card" style="--accent:${esc(accent)}">
  <div class="shot">${shot}<span class="badge ${host.cls}">${esc(host.badge)}</span></div>
  <div class="body">
    <h2><a href="${esc(href)}">${esc(app.name)}</a></h2>
    <p class="tagline">${esc(app.tagline)}</p>
    ${note}
    ${tags}
    <p class="meta">${author}${source}<span class="host">${esc(host.meta)}</span></p>
  </div>
</article>`;
}

function page({ site, apps }) {
  const hosted = apps.filter(isHosted).length;
  const elsewhere = apps.filter((a) => a.type === 'redirect' || a.type === 'proxy').length;
  const links = apps.filter((a) => a.type === 'link').length;

  const counts = [
    `<li><b>${apps.length}</b> ${apps.length === 1 ? 'thing' : 'things'}</li>`,
    hosted ? `<li><b>${hosted}</b> hosted here</li>` : '',
    elsewhere ? `<li><b>${elsewhere}</b> elsewhere</li>` : '',
    links ? `<li><b>${links}</b> repo only</li>` : '',
  ].filter(Boolean).join('');

  const body = apps.length
    ? `<div class="grid">\n${apps.map((a) => card(a, site)).join('\n')}\n</div>`
    : `<p class="empty">Nothing parked here yet.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(site.title)} &mdash; ${esc(site.tagline)}</title>
<meta name="description" content="${esc(site.blurb)}">
<meta name="theme-color" content="#0b0f17">
<meta property="og:title" content="${esc(site.title)}">
<meta property="og:description" content="${esc(site.blurb)}">
<meta property="og:type" content="website">
<meta property="og:url" content="https://${esc(site.domain)}/">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<div class="wrap">
<header>
  <h1 class="mark"><em>stunt</em>camp<span>${esc(site.domain)}</span></h1>
  <p class="lede">${esc(site.blurb)} <b>Every one of them gets a subdomain.</b></p>
  <ul class="counts">${counts}</ul>
</header>
<main>
${body}
</main>
<footer>
  <span>a personal geocities for stunt apps</span>
  <span class="right"><a href="https://github.com/kypflug/stuntcamp" rel="noopener">park something here</a></span>
</footer>
</div>
</body>
</html>
`;
}

function notFound(site) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>nothing parked here &mdash; ${esc(site.title)}</title>
<meta name="theme-color" content="#0b0f17">
<link rel="stylesheet" href="/assets/style.css">
</head>
<body>
<div class="oops">
  <h1>nothing parked here</h1>
  <p>That subdomain has not been claimed on <code>${esc(site.domain)}</code>.</p>
  <a class="cta" href="https://${esc(site.domain)}/">see what is</a>
</div>
</body>
</html>
`;
}

function main() {
  const site = loadSite();
  const all = loadApps();

  const { errors, warnings } = validateAll(all, site);
  for (const w of warnings) console.warn(`warn  ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`error ${e}`);
    throw new Error('registry is invalid; refusing to build the index');
  }

  const apps = all.filter((a) => a.visible !== false);

  rmSync(join(DIST, 'index.html'), { force: true });
  mkdirSync(join(DIST, 'assets'), { recursive: true });

  writeFileSync(join(DIST, 'index.html'), page({ site, apps }), 'utf8');
  writeFileSync(join(DIST, '404.html'), notFound(site), 'utf8');
  writeFileSync(
    join(DIST, 'apps.json'),
    `${JSON.stringify(apps.map(({ _file, _basename, ...a }) => a), null, 2)}\n`,
    'utf8',
  );

  const assets = join(HUB, 'assets');
  if (existsSync(assets) && readdirSync(assets).length) {
    cpSync(assets, join(DIST, 'assets'), { recursive: true });
  }
  cpSync(join(HUB, 'style.css'), join(DIST, 'assets', 'style.css'));
  cpSync(join(HUB, 'staticwebapp.config.json'), join(DIST, 'staticwebapp.config.json'));

  console.log(`hub   ${apps.length} card(s) -> dist/index.html`);
}

main();
