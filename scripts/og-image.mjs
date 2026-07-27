#!/usr/bin/env node
/**
 * Renders the social preview card to hub/assets/og.jpg.
 *
 *   npm run build && node scripts/og-image.mjs
 *
 * The card is drawn with the site's own stylesheet rather than a copy of it:
 * the page below is written into dist/ and links the built, fingerprinted CSS,
 * so the wordmark here is the wordmark the site ships — same painting, same
 * gradient, same crop — and cannot drift from it. All this file adds is the
 * card's geometry.
 *
 * Playwright and sharp are CI-only, exactly like scripts/screenshot.mjs — the
 * hub build itself stays dependency-free and simply copies whatever image is
 * committed.
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { DIST, ROOT, loadSite, stylesheet } from './registry.mjs';

const site = loadSite();
const OUT = join(ROOT, 'hub', 'assets', 'og.jpg');
const { name: cssName } = stylesheet();

if (!existsSync(join(DIST, 'assets', cssName))) {
  throw new Error(`dist/assets/${cssName} is missing — run npm run build first`);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Geometry only. Everything with an opinion — paper, ink, the four faces, the
// painting inside "camp" — comes from the stylesheet linked above it.
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="assets/${cssName}">
<style>
  body { width: 1200px; height: 630px; min-height: 0; overflow: hidden; padding: 0 84px;
         display: flex; flex-direction: column; justify-content: center; gap: 28px; }
  .mark { font-size: 148px; }
  .lede { max-width: none; font-size: 34px; }
  .foot { position: absolute; left: 84px; bottom: 56px;
          font: var(--type-meta); font-size: 20px; letter-spacing: var(--track-meta);
          text-transform: uppercase; color: var(--ink-3); }
</style></head>
<body>
  <h1 class="mark"><em>stunt</em><i class="camp">camp</i></h1>
  <p class="lede">${esc(site.blurb)}</p>
  <div class="foot">${esc(site.domain)}</div>
</body></html>
`;

// Written inside dist/ so every relative URL in the stylesheet — the fonts, the
// painting and its ladder — resolves to the file the site actually serves.
const tmpPage = join(DIST, '.og-tmp.html');
writeFileSync(tmpPage, html, 'utf8');

const browser = await chromium.launch();
// Rendered at 2x and resampled down: it makes the type crisper than a 1x
// screenshot, and it is the density at which the stylesheet's image-set() hands
// over the larger rung of the painting.
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
});
try {
  await page.goto(pathToFileURL(tmpPage).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  // JPEG, like the thumbnails: capture losslessly from Playwright, then let
  // sharp do the final encode. The card is large type over a painting, so PNG
  // would spend most of its bytes describing photographic texture losslessly.
  const png = await page.screenshot({ type: 'png' });
  await sharp(png).resize(1200, 630).jpeg({ quality: 90, mozjpeg: true }).toFile(OUT);
  console.log(`og    ${site.domain} card -> hub/assets/og.jpg`);
} finally {
  await browser.close();
  rmSync(tmpPage, { force: true });
}
