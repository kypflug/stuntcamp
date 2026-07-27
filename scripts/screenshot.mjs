#!/usr/bin/env node
/**
 * Captures a thumbnail for every app that does not override one, writing
 * hub/assets/thumbs/<slug>.jpg. Run after a deploy so the shots match what is
 * actually live.
 *
 *   node scripts/screenshot.mjs                  # shoot live subdomains
 *   node scripts/screenshot.mjs --local          # shoot the local preview
 *   node scripts/screenshot.mjs --only aethercalc
 *
 * Playwright and sharp are CI-only: the hub build itself stays dependency-free
 * and simply uses whatever thumbnails exist.
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { ROOT, loadApps, loadSite, publicUrl } from './registry.mjs';

const LOCAL = process.argv.includes('--local');
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1] : null;
})();
const PORT = Number(process.env.PORT || 8787);

const THUMBS = join(ROOT, 'hub', 'assets', 'thumbs');
const VIEWPORT = { width: 1280, height: 800 };

const site = loadSite();
let apps = loadApps()
  .filter((a) => a.visible !== false)
  .filter((a) => !a.thumbnail)
  .filter((a) => a.type !== 'link');
if (ONLY) apps = apps.filter((a) => a.slug === ONLY);

mkdirSync(THUMBS, { recursive: true });

const FREEZE = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';

// Light and dark are captured separately and swapped with <picture>, so an
// app's screenshot always matches the visitor's theme.
const SCHEMES = [
  { name: 'light', suffix: '' },
  { name: 'dark', suffix: '-dark' },
];

const browser = await chromium.launch();

let ok = 0;
let failed = 0;

for (const app of apps) {
  const url = LOCAL ? `http://${app.slug}.localhost:${PORT}/` : publicUrl(app, site);

  for (const scheme of SCHEMES) {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      colorScheme: scheme.name,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    try {
      const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
      if (res && res.status() >= 400) throw new Error(`HTTP ${res.status()}`);
      // Freeze anything that moves. A blinking caret or running animation makes
      // every capture different, which would otherwise produce an endless stream
      // of "refresh thumbnails" commits.
      await page.addStyleTag({ content: FREEZE });
      await page.waitForTimeout(1200);
      // Cards render at a few hundred pixels wide, so a 1x JPEG keeps the index
      // light. Drop any stale thumbnail in another format for the same slug.
      const png = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, ...VIEWPORT },
      });
      await sharp(png).jpeg({ quality: 82, mozjpeg: true }).toFile(join(THUMBS, `${app.slug}${scheme.suffix}.jpg`));
      for (const ext of ['png', 'webp']) {
        rmSync(join(THUMBS, `${app.slug}${scheme.suffix}.${ext}`), { force: true });
      }
      console.log(`shot  ${app.slug} (${scheme.name}) <- ${url}`);
      ok += 1;
    } catch (err) {
      console.error(`FAIL  ${app.slug} (${scheme.name}) <- ${url}: ${err.message}`);
      failed += 1;
    } finally {
      await page.close();
      await context.close();
    }
  }

  // Plenty of apps ignore prefers-color-scheme, in which case both captures are
  // identical. Drop the redundant dark copy so the page emits a plain <img>.
  const light = join(THUMBS, `${app.slug}.jpg`);
  const dark = join(THUMBS, `${app.slug}-dark.jpg`);
  if (existsSync(light) && existsSync(dark) && readFileSync(light).equals(readFileSync(dark))) {
    rmSync(dark, { force: true });
    console.log(`same  ${app.slug} renders identically in both themes, keeping one`);
  }
}

await browser.close();
console.log(`\nshots ${ok} captured${failed ? `, ${failed} failed (existing thumbnails kept)` : ''}`);
