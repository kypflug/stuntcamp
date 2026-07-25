#!/usr/bin/env node
/**
 * Turns the registry into the routing table the Cloudflare Worker embeds at
 * deploy time: worker/routes.json. The Worker never reads the registry itself,
 * so a bad manifest can't take the front door down.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, isHosted, loadApps, loadSite, validateAll } from './registry.mjs';

const site = loadSite();
const all = loadApps();

const { errors } = validateAll(all, site);
if (errors.length) {
  for (const e of errors) console.error(`error ${e}`);
  throw new Error('registry is invalid; refusing to build routes');
}

const routes = {};
for (const app of all) {
  if (app.visible === false) continue;
  if (isHosted(app)) {
    routes[app.slug] = { kind: 'hosted', path: `${site.appPathPrefix}/${app.slug}`, name: app.name };
  } else if (app.type === 'redirect') {
    routes[app.slug] = { kind: 'redirect', url: app.url, name: app.name };
  } else if (app.type === 'proxy') {
    routes[app.slug] = { kind: 'proxy', url: app.url, name: app.name };
  }
}

const table = {
  generated: new Date().toISOString(),
  domain: site.domain,
  appPathPrefix: site.appPathPrefix,
  routes,
};

const out = join(ROOT, 'worker', 'routes.json');
mkdirSync(join(ROOT, 'worker'), { recursive: true });
writeFileSync(out, `${JSON.stringify(table, null, 2)}\n`, 'utf8');
console.log(`routes ${Object.keys(routes).length} subdomain(s) -> worker/routes.json`);
