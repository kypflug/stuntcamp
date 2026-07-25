#!/usr/bin/env node
/** Gate for registry PRs: schema-equivalent checks plus cross-app collisions. */
import { loadApps, loadSite, validateAll } from './registry.mjs';

const site = loadSite();
const apps = loadApps();
const { errors, warnings } = validateAll(apps, site);

for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);

if (errors.length) {
  console.error(`\n${errors.length} error(s) in ${apps.length} manifest(s).`);
  process.exit(1);
}

console.log(`ok    ${apps.length} manifest(s) valid${warnings.length ? `, ${warnings.length} warning(s)` : ''}`);
