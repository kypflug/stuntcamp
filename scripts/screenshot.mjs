#!/usr/bin/env node
/**
 * Captures a thumbnail for every app that does not override one, writing
 * hub/assets/thumbs/<slug>.png. Run after a deploy so the shots match what is
 * actually live.
 *
 *   node scripts/screenshot.mjs                  # shoot live subdomains
 *   node scripts/screenshot.mjs --local          # shoot the local preview
 *   node scripts/screenshot.mjs --only aethercalc
 *
 * Playwright is the one dependency in the repo and it is CI-only: the hub build
 * itself stays dependency-free and simply uses whatever thumbnails exist.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
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

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  reducedMotion: 'reduce',
});

let ok = 0;
let failed = 0;

for (const app of apps) {
  const url = LOCAL ? `http://${app.slug}.localhost:${PORT}/` : publicUrl(app, site);
  const page = await context.newPage();
  try {
    const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    if (res && res.status() >= 400) throw new Error(`HTTP ${res.status()}`);
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: join(THUMBS, `${app.slug}.png`),
      clip: { x: 0, y: 0, ...VIEWPORT },
    });
    console.log(`shot  ${app.slug} <- ${url}`);
    ok += 1;
  } catch (err) {
    console.error(`FAIL  ${app.slug} <- ${url}: ${err.message}`);
    failed += 1;
  } finally {
    await page.close();
  }
}

await browser.close();
console.log(`\nshots ${ok} captured${failed ? `, ${failed} failed (existing thumbnails kept)` : ''}`);
