#!/usr/bin/env node
/**
 * Renders the stuntcamp index from the registry. Zero dependencies on purpose:
 * the hub is a static gallery, and nothing here should ever need updating.
 *
 * Outputs dist/index.html, dist/404.html, dist/apps.json and dist/assets/.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIST, ROOT, LADDER_FORMATS, THUMB_WIDTHS, loadApps, loadSite, publicUrl, stylesheet, validateAll, variantName } from '../scripts/registry.mjs';

const HUB = join(ROOT, 'hub');
const THUMBS = join(HUB, 'assets', 'thumbs');

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * The one icon in the system, lifted from aldenblog.io: an "arrow out of box"
 * that follows the last word of a title opening an address we do not control.
 * Everything else that would be an icon here is a word.
 */
const EXTERNAL_ICON = ' <svg class="external-link-icon" viewBox="0 0 24 24" aria-hidden="true">'
  + '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>'
  + '</svg>';

/**
 * The painting that shows through the "camp" letterforms is a CSS background,
 * so a browser only finds it once the stylesheet has parsed — and it is the
 * largest thing above the fold. These preloads carry the same densities the
 * stylesheet's image-set() offers, so the fetch they start is the one the
 * background ends up wanting. The media query means only one scheme is ever
 * fetched, and the type means engines without AVIF skip the hint and simply
 * take the JPEG when the CSS lands.
 */
const WORDMARK_ART = `<link rel="preload" as="image" type="image/avif" media="(prefers-color-scheme: light)" imagesrcset="assets/ridge.320.avif 1x, assets/ridge.640.avif 2x">
<link rel="preload" as="image" type="image/avif" media="(prefers-color-scheme: dark)" imagesrcset="assets/ridge-dark.320.avif 1x, assets/ridge-dark.640.avif 2x">`;


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
 * How wide a card actually is, so the browser can pick a rung instead of
 * guessing the full viewport. The grid is `auto-fill, minmax(19rem, 1fr)` with
 * a 20px gap inside a 1216px page and a clamped page gutter, which works out
 * as three columns above ~1032px, two above ~688px, and one below. Close
 * enough: `sizes` only has to land the browser on the right candidate.
 */
const SIZES = '(min-width: 1296px) 392px, (min-width: 1032px) 33vw, (min-width: 688px) 48vw, calc(100vw - 40px)';

/**
 * The rungs scripts/images.mjs cut from a capture, as srcset strings keyed by
 * format. Missing rungs are simply not linked, so a hand-committed shot that
 * has never been through the ladder still renders — it just ships whole.
 */
function ladder(rel) {
  if (!rel || /^https?:/i.test(rel)) return null;
  const found = {};
  for (const fmt of LADDER_FORMATS) {
    const rungs = THUMB_WIDTHS
      .map((w) => ({ w, file: variantName(rel, w, fmt) }))
      .filter(({ file }) => existsSync(join(HUB, file)))
      .map(({ w, file }) => `${file} ${w}w`);
    if (rungs.length) found[fmt] = rungs.join(', ');
  }
  return Object.keys(found).length ? found : null;
}

/**
 * A card's screenshot. Two axes stack here: colour scheme, which is a media
 * query, and format plus width, which is a srcset. The dark sources come first
 * because a <picture> takes the first source that matches.
 */
function shotFor(light, dark, alt) {
  const attrs = `alt="${esc(alt)}" loading="lazy" decoding="async" width="1280" height="800"`;
  const lightRungs = ladder(light);
  const darkRungs = dark ? ladder(dark) : null;
  const sources = [];

  if (dark) {
    for (const fmt of LADDER_FORMATS) {
      if (!darkRungs?.[fmt]) continue;
      const type = fmt === 'jpg' ? '' : ` type="image/${fmt}"`;
      sources.push(`<source media="(prefers-color-scheme: dark)"${type} srcset="${esc(darkRungs[fmt])}" sizes="${SIZES}">`);
    }
    // The whole capture, for a browser that has the media query but no ladder.
    sources.push(`<source media="(prefers-color-scheme: dark)" srcset="${esc(dark)}">`);
  }

  for (const fmt of LADDER_FORMATS) {
    if (fmt === 'jpg' || !lightRungs?.[fmt]) continue;
    sources.push(`<source type="image/${fmt}" srcset="${esc(lightRungs[fmt])}" sizes="${SIZES}">`);
  }

  const fallback = lightRungs?.jpg ? ` srcset="${esc(lightRungs.jpg)}" sizes="${SIZES}"` : '';
  const img = `<img src="${esc(light)}"${fallback} ${attrs}>`;
  return sources.length ? `<picture>${sources.join('')}${img}</picture>` : img;
}

/**
 * What a card promises. The registry already knows whether an app is served
 * from this Static Web App, redirects to somebody else's host, is proxied under
 * our address, or is only a repo link — but the card used to keep that to
 * itself, so an extension repo looked exactly like an app you could open.
 *
 * Almanac gives a type three accents and no more, so the four registry types
 * fold onto them: hosted here is post green, anything living at somebody
 * else's address is project teal, a repo you can only read is link ochre.
 */
const DEST_BADGES = {
  redirect: { label: 'Offsite', kind: 'project' },
  proxy: { label: 'Proxied', kind: 'project' },
  link: { label: 'Repo only', kind: 'link' },
};

function destination(app, site) {
  const badge = DEST_BADGES[app.type] || { label: 'Hosted', kind: 'post' };
  // redirect and link both hand the visitor to an address we do not control.
  if (app.type === 'redirect' || app.type === 'link') {
    let where = app.url;
    try {
      const u = new URL(app.url);
      // Keep the path: "github.com" says far less than "github.com/kypflug/x",
      // and .where ellipses anything too long for the card.
      where = (u.host + u.pathname).replace(/\/$/, '');
    } catch { /* validator already flagged it */ }
    return { ...badge, where: `\u2192 ${where}`, external: true };
  }
  return { ...badge, where: `${app.slug}.${site.domain}`, external: false };
}

function card(app, site) {
  const href = publicUrl(app, site);
  const { light, dark } = findThumbs(app);
  const dest = destination(app, site);

  let shot;
  if (light) {
    shot = shotFor(light, dark, `Screenshot of ${app.name}`);
  } else {
    shot = `<span class="glyph" aria-hidden="true">${esc(app.name.slice(0, 2))}</span>`;
  }

  const author = app.author
    ? (app.author.url
      ? `<a href="${esc(app.author.url)}" rel="noopener">${esc(app.author.name)}</a>`
      : esc(app.author.name))
    : '&mdash;';

  const source = app.source
    ? `<span aria-hidden="true">&middot;</span><a href="${esc(app.source)}" rel="noopener">source</a>`
    : '';

  // app.tags is deliberately not rendered: filled chips read as filters, and
  // there is nothing to filter yet. The field stays in the registry for when
  // the shelf is full enough that browsing by tag earns its place.
  return `<article class="card">
  <div class="shot">${shot}</div>
  <div class="body">
    <div class="hrow">
      <h2><a href="${esc(href)}"${dest.external ? ' rel="noopener"' : ''}>${esc(app.name)}${dest.external ? EXTERNAL_ICON : ''}</a></h2>
      <span class="badge badge--${dest.kind}">${esc(dest.label)}</span>
    </div>
    <p class="tagline">${esc(app.tagline)}</p>
    <p class="meta"><span class="where">${esc(dest.where)}</span><span class="who">${author}${source}</span></p>
  </div>
</article>`;
}

/**
 * The invitation, drawn as the slot an app has not filled yet. It is the only
 * card without a surface: a dashed hairline where a manifest would be.
 */
const PARK_CARD = `<article class="park">
  <h2>Park something here</h2>
  <p>Add your project to stuntcamp with a pull request.</p>
  <a class="go" href="https://github.com/kypflug/stuntcamp/blob/main/docs/ADDING-AN-APP.md" rel="noopener">Read the docs &rarr;</a>
</article>`;

function page({ site, apps, cssHref }) {
  const cards = apps.length
    ? apps.map((a) => card(a, site)).join('\n')
    : `<p class="empty">Nothing parked here yet.</p>`;
  const body = `<div class="grid">\n${cards}\n${PARK_CARD}\n</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(site.title)} &mdash; ${esc(site.tagline)}</title>
<meta name="description" content="${esc(site.blurb)}">
<meta name="theme-color" content="#e4eaee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#101820" media="(prefers-color-scheme: dark)">
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
<link rel="preload" href="assets/fonts/space-grotesk-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="assets/fonts/ibm-plex-sans-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="assets/fonts/ibm-plex-mono-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="assets/fonts/ibm-plex-mono-500.woff2" as="font" type="font/woff2" crossorigin>
${WORDMARK_ART}
<link rel="stylesheet" href="${esc(cssHref)}">
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
  <span>a personal parking lot for stunt apps</span>
  <span class="right"><a href="https://github.com/kypflug/stuntcamp" rel="noopener">park something here</a></span>
</footer>
</div>
</body>
</html>
`;
}

function notFound(site, cssHref) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>nothing parked here &mdash; ${esc(site.title)}</title>
<meta name="theme-color" content="#e4eaee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#101820" media="(prefers-color-scheme: dark)">
<link rel="icon" href="https://${esc(site.domain)}/assets/favicon.svg" type="image/svg+xml">
<link rel="preload" href="https://${esc(site.domain)}/assets/fonts/space-grotesk-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="https://${esc(site.domain)}/assets/fonts/ibm-plex-sans-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="https://${esc(site.domain)}/assets/fonts/ibm-plex-mono-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="https://${esc(site.domain)}/${esc(cssHref)}">
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

  // The stylesheet filename carries a hash of its own contents. Azure and
  // Cloudflare both put a multi-hour max-age on a stable filename, so without
  // this a returning visitor can be served today's markup against yesterday's
  // CSS — new class names, old rules, a card that falls apart. A new hash is a
  // new URL, so that pairing cannot happen.
  const { css, name: cssName } = stylesheet();
  const cssHref = `assets/${cssName}`;
  rmSync(join(DIST, 'index.html'), { force: true });
  mkdirSync(join(DIST, 'assets'), { recursive: true });

  writeFileSync(join(DIST, 'index.html'), page({ site, apps, cssHref }), 'utf8');
  writeFileSync(join(DIST, '404.html'), notFound(site, cssHref), 'utf8');
  writeFileSync(
    join(DIST, 'apps.json'),
    `${JSON.stringify(apps.map(({ _file, _basename, ...a }) => a), null, 2)}\n`,
    'utf8',
  );

  const assets = join(HUB, 'assets');
  if (existsSync(assets) && readdirSync(assets).length) {
    // Emptied first: cpSync overwrites but never removes, so a renamed or
    // retired image would otherwise sit in a local dist forever and go on
    // being served by the preview. CI always starts from an empty dist.
    rmSync(join(DIST, 'assets'), { recursive: true, force: true });
    cpSync(assets, join(DIST, 'assets'), { recursive: true });
  }
  writeFileSync(join(DIST, 'assets', cssName), css);
  cpSync(join(HUB, 'staticwebapp.config.json'), join(DIST, 'staticwebapp.config.json'));

  console.log(`hub   ${apps.length} card(s) -> dist/index.html (${cssName})`);
}

main();
