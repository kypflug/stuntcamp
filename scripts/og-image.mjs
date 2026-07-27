#!/usr/bin/env node
/**
 * Renders the social preview card to hub/assets/og.jpg.
 *
 *   npm run build && node scripts/og-image.mjs
 *
 * The wordmark scene is lifted straight out of the built index.html rather than
 * redefined here, so the card can never drift from what the site actually shows.
 * Playwright and sharp are CI-only, exactly like scripts/screenshot.mjs — the
 * hub build itself stays dependency-free and simply copies whatever image is
 * committed.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { DIST, ROOT, loadSite } from './registry.mjs';

const site = loadSite();
const HUB = join(ROOT, 'hub');
const OUT = join(HUB, 'assets', 'og.jpg');

const index = readFileSync(join(DIST, 'index.html'), 'utf8');

// The build injects `.camp{background-image:url("data:image/svg+xml,...")}` for
// light, then a dark override. Take the light one.
const sceneMatch = index.match(/\.camp\{background-image:(url\("data:image\/svg\+xml,[^"]+"\))\}/);
if (!sceneMatch) throw new Error('could not find the wordmark scene in dist/index.html — run npm run build first');
const scene = sceneMatch[1];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @font-face {
    font-family: Inter;
    font-weight: 400 700;
    src: url("assets/fonts/inter-latin-var.woff2") format("woff2");
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    display: flex; flex-direction: column; justify-content: center;
    gap: 28px; padding: 0 84px;
    background:
      radial-gradient(60rem 32rem at 12% -8%, #d2e3da, transparent 70%),
      radial-gradient(48rem 28rem at 92% 4%, #cfe0e5, transparent 68%),
      #e4ebe7;
    color: #1d3a2a;
    font: 400 16px/1.6 Inter, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  h1 {
    display: inline-flex; align-items: baseline;
    font: 700 148px/1 Inter, system-ui, sans-serif; letter-spacing: -.045em;
  }
  .camp {
    font-style: normal;
    background-image: ${scene};
    background-size: 100% 100%; background-repeat: no-repeat;
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .lede { font-size: 34px; color: #3d5a4a; letter-spacing: -.01em; }
  .foot {
    position: absolute; left: 84px; bottom: 56px;
    font: 22px/1 ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace; color: #4d6a5a;
  }
</style></head>
<body>
  <h1><em style="font-style:normal">stunt</em><i class="camp">camp</i></h1>
  <p class="lede">${esc(site.blurb)}</p>
  <div class="foot">${esc(site.domain)}</div>
</body></html>
`;

// Written inside hub/ so the @font-face relative URL resolves to the real file.
const tmpPage = join(HUB, '.og-tmp.html');
writeFileSync(tmpPage, html, 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
try {
  await page.goto(pathToFileURL(tmpPage).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  // JPEG, like the thumbnails: capture losslessly from Playwright, then let
  // sharp handle the final optimized encode.
  const png = await page.screenshot({ type: 'png' });
  await sharp(png).jpeg({ quality: 90, mozjpeg: true }).toFile(OUT);
  console.log(`og    ${site.domain} card -> hub/assets/og.jpg`);
} finally {
  await browser.close();
  rmSync(tmpPage, { force: true });
}
