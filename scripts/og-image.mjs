#!/usr/bin/env node
/**
 * Renders the social preview card to hub/assets/og.jpg.
 *
 *   npm run build && node scripts/og-image.mjs
 *
 * The wordmark's painting is lifted straight out of hub/style.css rather than
 * redefined here, so the card can never drift from what the site actually
 * shows. Playwright and sharp are CI-only, exactly like scripts/screenshot.mjs
 * — the hub build itself stays dependency-free and simply copies whatever image
 * is committed.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { ROOT, loadSite } from './registry.mjs';

const site = loadSite();
const HUB = join(ROOT, 'hub');
const OUT = join(HUB, 'assets', 'og.jpg');

const css = readFileSync(join(HUB, 'style.css'), 'utf8');

// The light-mode .camp rule: the ridgeline panorama under a darkening gradient,
// scaled and cropped so the peaks land inside the x-height.
const campMatch = css.match(/\n\.camp \{([\s\S]*?)\n\}/);
if (!campMatch) throw new Error('could not find the .camp rule in hub/style.css');
// The stylesheet is served from /assets/, so its URLs are relative to that
// directory; this page is written to hub/ and needs the extra segment.
const camp = campMatch[1].replace(/url\("/g, 'url("assets/');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @font-face { font-family: "Playfair Display"; font-weight: 400 700; src: url("assets/fonts/playfair-display-var.woff2") format("woff2"); }
  @font-face { font-family: "Source Serif 4"; font-weight: 400 600; src: url("assets/fonts/source-serif-4-var.woff2") format("woff2"); }
  @font-face { font-family: "IBM Plex Mono"; font-weight: 400; src: url("assets/fonts/ibm-plex-mono-400.woff2") format("woff2"); }
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    display: flex; flex-direction: column; justify-content: center;
    gap: 28px; padding: 0 84px;
    background: #f4f1ea;
    color: #16201c;
    font: 400 16px/1.6 "Source Serif 4", Georgia, serif;
    -webkit-font-smoothing: antialiased;
  }
  h1 {
    display: inline-flex; align-items: baseline;
    font: 600 148px/1 "Playfair Display", Georgia, serif; letter-spacing: -.03em;
  }
  .camp {${camp}
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .lede { font-size: 34px; color: #48564f; }
  .foot {
    position: absolute; left: 84px; bottom: 56px;
    font: 400 20px/1 "IBM Plex Mono", Consolas, monospace;
    letter-spacing: .06em; text-transform: uppercase; color: #646f6a;
  }
</style></head>
<body>
  <h1><em style="font-style:normal">stunt</em><i class="camp">camp</i></h1>
  <p class="lede">${esc(site.blurb)}</p>
  <div class="foot">${esc(site.domain)}</div>
</body></html>
`;

// Written inside hub/ so the relative font and painting URLs resolve to the
// real files.
const tmpPage = join(HUB, '.og-tmp.html');
writeFileSync(tmpPage, html, 'utf8');

const browser = await chromium.launch();
// Rendered at 2x and resampled down: it makes the type crisper than a 1x
// screenshot, and it is the density at which the stylesheet's image-set() hands
// over the larger rung of the painting.
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
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
