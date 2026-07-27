#!/usr/bin/env node
/**
 * Cuts every image the index links into the ladder it links it at.
 *
 *   node scripts/images.mjs
 *   node scripts/images.mjs --only aethercalc
 *
 * Card screenshots get 400w and 800w: a card is about 392 CSS pixels wide on
 * the widest layout and never wider than the phone viewport, so the 1280w
 * capture that used to be the only file on offer was three times the size
 * anyone needed. The wordmark painting gets 320w and 640w, because the "camp"
 * letterforms it shows through are only 209 CSS pixels across.
 *
 * Sources stay committed — they are what these rungs are cut from, and what a
 * browser without srcset or image-set falls back to.
 *
 * sharp is CI-only, exactly like Playwright: hub/build.mjs stays
 * dependency-free and simply links whichever rungs it finds on disk.
 */
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import sharp from 'sharp';
import { ART_WIDTHS, LADDER_FORMATS, ROOT, THUMB_WIDTHS, isVariant, variantName } from './registry.mjs';

const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const ASSETS = join(ROOT, 'hub', 'assets');

/**
 * Everything that gets a ladder, and how wide. Anything else in hub/assets/ —
 * the social card, the favicon — is left alone.
 */
const SUBJECTS = [
  { dir: join(ASSETS, 'thumbs'), widths: THUMB_WIDTHS },
  { dir: join(ASSETS, 'shots'), widths: THUMB_WIDTHS },
  { dir: ASSETS, widths: ART_WIDTHS, only: ['ridge.jpg', 'ridge-dark.jpg'] },
];

/**
 * AVIF is where the saving is — roughly half a JPEG at the same perceived
 * quality — but the card images are screenshots, so the chroma has to stay full
 * resolution or the coloured UI text in them turns to mud.
 */
const ENCODE = {
  avif: (img) => img.avif({ quality: 55, effort: 4, chromaSubsampling: '4:4:4' }),
  jpg: (img) => img.jpeg({ quality: 78, mozjpeg: true }),
};

const isSource = (file, only) => (only
  ? only.includes(file)
  : extname(file).toLowerCase() === '.jpg' && !isVariant(file));

let written = 0;
let pruned = 0;

for (const { dir, widths, only } of SUBJECTS) {
  if (!existsSync(dir)) continue;
  const files = readdirSync(dir);

  // Drop rungs whose source has gone: an app leaves the registry, or a
  // manifest starts overriding its thumbnail, and the ladder should follow.
  for (const file of files) {
    if (!isVariant(file)) continue;
    const source = file.replace(/-\d+\.(avif|jpg)$/, '.jpg');
    if (only && !only.includes(source)) continue;
    if (files.includes(source)) continue;
    rmSync(join(dir, file), { force: true });
    pruned += 1;
  }

  for (const file of files) {
    if (!isSource(file, only)) continue;
    const stem = basename(file, '.jpg');
    if (ONLY && stem !== ONLY && stem !== `${ONLY}-dark`) continue;

    const source = sharp(join(dir, file));
    const { width } = await source.metadata();

    for (const w of widths) {
      // Never upscale: a rung wider than the source would cost bytes to
      // invent detail that was never captured.
      if (width && w > width) continue;
      const resized = source.clone().resize({ width: w, withoutEnlargement: true });
      for (const fmt of LADDER_FORMATS) {
        await ENCODE[fmt](resized.clone()).toFile(join(dir, variantName(file, w, fmt)));
        written += 1;
      }
    }
    console.log(`ladder ${stem} -> ${widths.join('w, ')}w`);
  }
}

console.log(`images ${written} variant(s) written${pruned ? `, ${pruned} pruned` : ''}`);
