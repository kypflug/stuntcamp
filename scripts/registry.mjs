import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const REGISTRY_DIR = join(ROOT, 'registry');
export const APPS_DIR = join(REGISTRY_DIR, 'apps');
export const DIST = join(ROOT, 'dist');

export const HOSTED_TYPES = ['in-repo', 'source-build', 'artifact'];
export const ALL_TYPES = [...HOSTED_TYPES, 'redirect', 'proxy', 'link'];

/** Types whose files get built into the hub Static Web App under /a/<slug>/. */
export const isHosted = (app) => HOSTED_TYPES.includes(app.type);

/** Types that answer on <slug>.stuntcamp.app. `link` is index-only. */
export const hasSubdomain = (app) => app.type !== 'link';

export function loadSite() {
  return JSON.parse(readFileSync(join(REGISTRY_DIR, 'site.json'), 'utf8'));
}

export function loadApps() {
  if (!existsSync(APPS_DIR)) return [];
  return readdirSync(APPS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const path = join(APPS_DIR, f);
      let data;
      try {
        data = JSON.parse(readFileSync(path, 'utf8'));
      } catch (err) {
        throw new Error(`registry/apps/${f} is not valid JSON: ${err.message}`);
      }
      delete data.$schema;
      return { ...data, _file: `registry/apps/${f}`, _basename: basename(f, '.json') };
    })
    .sort((a, b) => (a.slug || '').localeCompare(b.slug || ''));
}

export function publicUrl(app, site) {
  if (app.type === 'link') return app.url;
  return `https://${app.slug}.${site.domain}`;
}

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHA_RE = /^[0-9a-f]{40}$/;

const KNOWN_KEYS = new Set([
  'slug', 'name', 'tagline', 'type', 'author', 'source', 'url',
  'build', 'tags', 'accent', 'thumbnail', 'added', 'visible',
  '_file', '_basename',
]);

const KNOWN_BUILD_KEYS = new Set([
  'repo', 'ref', 'install', 'command', 'output', 'artifact', 'asset', 'branch', 'release',
]);

function httpsUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Validates one manifest. Returns { errors, warnings } of plain strings.
 * Deliberately hand-rolled rather than pulling in a JSON Schema library:
 * registry/schema.json exists for editor autocomplete, this is the gate.
 */
export function validateApp(app, site, seenSlugs = new Set()) {
  const errors = [];
  const warnings = [];
  const where = app._file || 'manifest';
  const err = (m) => errors.push(`${where}: ${m}`);
  const warn = (m) => warnings.push(`${where}: ${m}`);

  for (const key of Object.keys(app)) {
    if (!KNOWN_KEYS.has(key)) err(`unknown field "${key}"`);
  }

  if (typeof app.slug !== 'string' || !SLUG_RE.test(app.slug)) {
    err('slug must be a single lowercase DNS label (a-z, 0-9, hyphens, no leading/trailing hyphen)');
  } else {
    if (app._basename && app._basename !== app.slug) {
      err(`filename must match the slug (expected ${app.slug}.json)`);
    }
    if ((site.reservedSlugs || []).includes(app.slug)) {
      err(`slug "${app.slug}" is reserved`);
    }
    if (seenSlugs.has(app.slug)) err(`duplicate slug "${app.slug}"`);
    seenSlugs.add(app.slug);
  }

  if (typeof app.name !== 'string' || !app.name.trim()) err('name is required');
  if (typeof app.tagline !== 'string' || !app.tagline.trim()) {
    err('tagline is required');
  } else if (app.tagline.length > 160) {
    err('tagline must be 160 characters or fewer');
  }
  if (!ALL_TYPES.includes(app.type)) {
    err(`type must be one of: ${ALL_TYPES.join(', ')}`);
  }

  if (app.author != null) {
    if (typeof app.author !== 'object' || !app.author.name) err('author.name is required when author is set');
    if (app.author?.url && !httpsUrl(app.author.url)) err('author.url must be an http(s) URL');
  } else {
    warn('no author set; the card will not credit anyone');
  }

  if (app.source != null && !httpsUrl(app.source)) err('source must be an http(s) URL');
  if (app.accent != null && !HEX_RE.test(app.accent)) err('accent must be a #rrggbb hex colour');
  if (app.added != null && !DATE_RE.test(app.added)) err('added must be YYYY-MM-DD');
  if (app.visible != null && typeof app.visible !== 'boolean') err('visible must be a boolean');
  if (app.tags != null) {
    if (!Array.isArray(app.tags) || app.tags.some((t) => typeof t !== 'string')) {
      err('tags must be an array of strings');
    } else if (app.tags.length > 6) {
      err('at most 6 tags');
    }
  }
  if (app.thumbnail != null && typeof app.thumbnail !== 'string') {
    err('thumbnail must be a string path/URL or null');
  }

  if (['redirect', 'proxy', 'link'].includes(app.type)) {
    if (!app.url || !httpsUrl(app.url)) err(`type "${app.type}" requires a url`);
    if (app.build) err(`type "${app.type}" must not have a build block`);
    if (app.type === 'proxy' && app.url) {
      try {
        if (new URL(app.url).protocol !== 'https:') err('proxy url must be https');
      } catch { /* reported above */ }
    }
  }

  if (app.type === 'in-repo') {
    if (app.build) {
      for (const key of Object.keys(app.build)) {
        if (!KNOWN_BUILD_KEYS.has(key)) err(`unknown build field "${key}"`);
      }
    }
    if (app.slug && !existsSync(join(ROOT, 'apps', app.slug))) {
      err(`type "in-repo" expects a directory at apps/${app.slug}/`);
    }
  }

  if (app.type === 'source-build' || app.type === 'artifact') {
    const b = app.build;
    if (!b || typeof b !== 'object') {
      err(`type "${app.type}" requires a build block`);
    } else {
      for (const key of Object.keys(b)) {
        if (!KNOWN_BUILD_KEYS.has(key)) err(`unknown build field "${key}"`);
      }
      if (!b.repo || !REPO_RE.test(b.repo)) err('build.repo must be "owner/name"');

      if (app.type === 'source-build') {
        if (!b.command) err('build.command is required for source-build');
        if (!b.ref) {
          err('build.ref is required; pin it to a commit SHA');
        } else if (!SHA_RE.test(b.ref)) {
          warn(`build.ref "${b.ref}" is not a 40-char commit SHA — pinning is strongly preferred`);
        }
        if (b.output == null) err('build.output is required (use "." for the repo root)');
        if (b.artifact || b.asset || b.branch || b.release) {
          err('build.artifact/asset/branch/release only apply to type "artifact"');
        }
      }

      if (app.type === 'artifact') {
        if (b.command || b.install) err('type "artifact" does not run builds; drop build.command/install');
        const mode = b.artifact;
        if (mode !== 'release' && mode !== 'branch') {
          err('build.artifact must be "release" or "branch"');
        } else if (mode === 'release') {
          if (!b.asset) err('build.asset is required for artifact/release (e.g. dist.zip)');
        } else if (!b.branch) {
          err('build.branch is required for artifact/branch (e.g. gh-pages)');
        }
      }
    }
  }

  return { errors, warnings };
}

export function validateAll(apps, site) {
  const seen = new Set();
  const errors = [];
  const warnings = [];
  for (const app of apps) {
    const res = validateApp(app, site, seen);
    errors.push(...res.errors);
    warnings.push(...res.warnings);
  }
  return { errors, warnings };
}
