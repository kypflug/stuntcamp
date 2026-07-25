#!/usr/bin/env node
/**
 * Renders the stuntcamp index from the registry. Zero dependencies on purpose:
 * the hub is a static gallery, and nothing here should ever need updating.
 *
 * Outputs dist/index.html, dist/404.html, dist/apps.json and dist/assets/.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIST, ROOT, loadApps, loadSite, publicUrl, validateAll } from '../scripts/registry.mjs';

const HUB = join(ROOT, 'hub');
const THUMBS = join(HUB, 'assets', 'thumbs');

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * A mountain range for the wordmark to sit in front of, echoing the watercolor
 * hero on aldenblog.io. Three ridges, back to front, coloured from CSS custom
 * properties so it follows the light/dark theme. The bases are faded out by a
 * mask in the stylesheet, so the ridges read as peaks rather than as a block.
 */
const RANGE = `<svg class="range" viewBox="0 0 180 96" preserveAspectRatio="none" aria-hidden="true" focusable="false">
<path class="r1" d="M0 96 16 22l18 20L56 10l22 28 18-20 24 26 20-24 22 28 20 28z"/>
<path class="r2" d="M0 96 20 44l22 16 22-28 24 24 22-16 24 22 24-18 22 52z"/>
<path class="r3" d="M0 96 24 60l24 16 24-18 24 16 26-14 24 18 22-16 12 34z"/>
</svg>`;

/**
 * Auto-captured screenshots land in hub/assets/thumbs/ as a light/dark pair,
 * following the -dark suffix convention aldenblog.io uses. A manifest override
 * supplies one image for both themes.
 */
function findThumbs(app) {
  if (app.thumbnail) return { light: app.thumbnail, dark: null };
  if (!existsSync(THUMBS)) return { light: null, dark: null };
  const pick = (suffix) => {
    for (const ext of ['webp', 'png', 'jpg']) {
      if (existsSync(join(THUMBS, `${app.slug}${suffix}.${ext}`))) {
        return `assets/thumbs/${app.slug}${suffix}.${ext}`;
      }
    }
    return null;
  };
  return { light: pick(''), dark: pick('-dark') };
}

function card(app, site) {
  const href = publicUrl(app, site);
  const { light, dark } = findThumbs(app);
  const accent = app.accent || '#8aa4c8';

  let shot;
  if (light && dark) {
    shot = `<picture><source media="(prefers-color-scheme: dark)" srcset="${esc(dark)}"><img src="${esc(light)}" alt="Screenshot of ${esc(app.name)}" loading="lazy" decoding="async" width="1280" height="800"></picture>`;
  } else if (light) {
    shot = `<img src="${esc(light)}" alt="Screenshot of ${esc(app.name)}" loading="lazy" decoding="async" width="1280" height="800">`;
  } else {
    shot = `<span class="glyph" aria-hidden="true">${esc(app.name.slice(0, 2))}</span>`;
  }

  const tags = (app.tags || []).length
    ? `<ul class="tags">${app.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
    : '';

  const author = app.author
    ? (app.author.url
      ? `<a href="${esc(app.author.url)}" rel="noopener">${esc(app.author.name)}</a>`
      : esc(app.author.name))
    : '&mdash;';

  const source = app.source
    ? ` &middot; <a href="${esc(app.source)}" rel="noopener">source</a>`
    : '';

  return `<article class="card" style="--accent:${esc(accent)}">
  <div class="shot">${shot}</div>
  <div class="body">
    <h2><a href="${esc(href)}">${esc(app.name)}</a></h2>
    <p class="tagline">${esc(app.tagline)}</p>
    ${tags}
    <p class="meta">${author}${source}</p>
  </div>
</article>`;
}

function page({ site, apps }) {
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
<meta name="theme-color" content="#e4ebe7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0d1516" media="(prefers-color-scheme: dark)">
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
  <h1 class="mark"><em>stunt</em><span class="camp">${RANGE}<i>camp</i></span></h1>
  <p class="lede">${esc(site.blurb)}</p>
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
<meta name="theme-color" content="#e4ebe7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0d1516" media="(prefers-color-scheme: dark)">
<link rel="icon" href="https://${esc(site.domain)}/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="https://${esc(site.domain)}/assets/style.css">
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
