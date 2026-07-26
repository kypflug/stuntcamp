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
 * The mountain scene that shows through the "camp" letterforms. Colours are the
 * three stops of the wordmark's former gradient, so the palette moved into the
 * mountains rather than being lost: sage in the distance, teal in the middle,
 * slate in front. Every layer is filled with its own vertical gradient so no
 * edge reads as a flat cut-out, and only the distant range keeps hard angular
 * peaks — close enough in tone to the sky to pass for haze. Peaks sit low in
 * the viewBox to land inside the x-height, the only band wide enough to show
 * them. Emitted as a data URI so it costs no extra request.
 */
function scene(c) {
  const grad = (id, top, bottom) =>
    `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/>`
    + `</linearGradient>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 96" preserveAspectRatio="none">`
    + `<defs>`
    + grad('sky', c.sky1, c.sky2)
    + grad('far', c.far1, c.far2)
    + grad('mid', c.mid1, c.mid2)
    + grad('near', c.near1, c.near2)
    + `</defs>`
    + `<rect width="180" height="96" fill="url(#sky)"/>`
    + `<path fill="url(#far)" d="M0 96V60l18-16 12 10 18-24 18 22 14-12 18-8 16 20 18-18 18 20 16-12 14 16v38z"/>`
    + `<path fill="url(#mid)" d="M0 96V72q14-10 26-5t26-10q14-15 28-6t28-3q14-11 28 2t24 7v42z"/>`
    + `<path fill="url(#near)" d="M0 96V83c14-9 28-11 44-5s28 11 44 5 28-13 44-7 34 9 48 3v17z"/>`
    + `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const SCENE_LIGHT = scene({
  sky1: '#7fada4', sky2: '#5b949a',
  far1: '#5d8b7c', far2: '#4a7a6a',
  mid1: '#3d8894', mid2: '#2a7d8a',
  near1: '#456575', near2: '#3d5a65',
});

const SCENE_DARK = scene({
  sky1: '#cdeae1', sky2: '#a9d5c8',
  far1: '#97c9b8', far2: '#8ec4b2',
  mid1: '#79b6a4', mid2: '#6aa694',
  near1: '#58b3c0', near2: '#429aa9',
});

const WORDMARK_STYLE = `<style>
.camp{background-image:${SCENE_LIGHT}}
@media (prefers-color-scheme:dark){.camp{background-image:${SCENE_DARK}}}
</style>`;

/**
 * Auto-captured screenshots land in hub/assets/thumbs/ as a light/dark pair,
 * following the -dark suffix convention aldenblog.io uses. A manifest override
 * replaces them: a string is used for both themes, and `{ light, dark }`
 * supplies a pair that gets the same <picture> treatment as a captured one.
 */
function findThumbs(app) {
  if (typeof app.thumbnail === 'string' && app.thumbnail) {
    return { light: app.thumbnail, dark: null };
  }
  if (app.thumbnail && typeof app.thumbnail === 'object') {
    return { light: app.thumbnail.light || null, dark: app.thumbnail.dark || null };
  }
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

/**
 * What a card promises. The registry already knows whether an app is served
 * from this Static Web App, redirects to somebody else's host, is proxied under
 * our address, or is only a repo link — but the card used to keep that to
 * itself, so an extension repo looked exactly like an app you could open.
 */
const DEST_LABELS = {
  redirect: 'offsite',
  proxy: 'proxied',
  link: 'repo only',
};

function destination(app, site) {
  const label = DEST_LABELS[app.type] || 'hosted here';
  // redirect and link both hand the visitor to an address we do not control.
  if (app.type === 'redirect' || app.type === 'link') {
    let where = app.url;
    try {
      const u = new URL(app.url);
      // Keep the path: "github.com" says far less than "github.com/kypflug/x",
      // and .where ellipses anything too long for the card.
      where = (u.host + u.pathname).replace(/\/$/, '');
    } catch { /* validator already flagged it */ }
    return { label, where: `\u2192 ${where}` };
  }
  return { label, where: `${app.slug}.${site.domain}` };
}

function card(app, site) {
  const href = publicUrl(app, site);
  const { light, dark } = findThumbs(app);
  const accent = app.accent || '#8aa4c8';
  const dest = destination(app, site);

  let shot;
  if (light && dark) {
    shot = `<picture><source media="(prefers-color-scheme: dark)" srcset="${esc(dark)}"><img src="${esc(light)}" alt="Screenshot of ${esc(app.name)}" loading="lazy" decoding="async" width="1280" height="800"></picture>`;
  } else if (light) {
    shot = `<img src="${esc(light)}" alt="Screenshot of ${esc(app.name)}" loading="lazy" decoding="async" width="1280" height="800">`;
  } else {
    shot = `<span class="glyph" aria-hidden="true">${esc(app.name.slice(0, 2))}</span>`;
  }

  const author = app.author
    ? (app.author.url
      ? `<a href="${esc(app.author.url)}" rel="noopener">${esc(app.author.name)}</a>`
      : esc(app.author.name))
    : '&mdash;';

  const source = app.source
    ? ` &middot; <a href="${esc(app.source)}" rel="noopener">source</a>`
    : '';

  // app.tags is deliberately not rendered: filled chips read as filters, and
  // there is nothing to filter yet. The field stays in the registry for when
  // the shelf is full enough that browsing by tag earns its place.
  return `<article class="card" style="--accent:${esc(accent)}">
  <div class="shot">${shot}</div>
  <div class="body">
    <div class="hrow">
      <h2><a href="${esc(href)}">${esc(app.name)}</a></h2>
      <span class="dest">${esc(dest.label)}</span>
    </div>
    <p class="tagline">${esc(app.tagline)}</p>
    <p class="meta"><span class="where">${esc(dest.where)}</span><span class="who">${author}${source}</span></p>
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
<meta property="og:image" content="https://${esc(site.domain)}/assets/og.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(site.title)} &mdash; ${esc(site.blurb)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="preload" href="assets/fonts/inter-latin-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/style.css">
${WORDMARK_STYLE}
</head>
<body>
<div class="wrap">
<header>
  <h1 class="mark"><em>stunt</em><i class="camp">camp</i></h1>
  <div class="says">
    <p class="lede">${esc(site.blurb)}</p>
    ${site.author ? `<p class="by">a project by <a href="${esc(site.author.url)}" rel="noopener">${esc(site.author.name)}</a></p>` : ''}
  </div>
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
<link rel="preload" href="https://${esc(site.domain)}/assets/fonts/inter-latin-var.woff2" as="font" type="font/woff2" crossorigin>
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
