/**
 * stuntcamp front door.
 *
 * Cloudflare terminates TLS for stuntcamp.app and every *.stuntcamp.app under
 * free Universal SSL, so the Azure Static Web App needs no custom domain of its
 * own. This Worker decides what each hostname means:
 *
 *   stuntcamp.app / www   -> the hub index at the SWA root
 *   <slug>.stuntcamp.app  -> hosted:   reverse proxy to SWA /a/<slug>/...
 *                            redirect: 301 to an external URL
 *                            proxy:    reverse proxy to an external origin
 *   anything else         -> the hub's 404 page
 *
 * routes.json is generated from the registry at deploy time by
 * scripts/build-routes.mjs. The Worker never reads the registry directly, so a
 * malformed manifest can never take the front door down.
 */
import table from '../routes.json';

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

/** Returns the single label under the apex, or null for apex/multi-level hosts. */
function slugOf(hostname, domain) {
  const host = hostname.toLowerCase();
  if (host === domain || !host.endsWith('.' + domain)) return null;
  const label = host.slice(0, -(domain.length + 1));
  return label.includes('.') ? null : label;
}

function withHeaders(res, extra) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const joinPath = (...parts) => ('/' + parts.join('/')).replace(/\/{2,}/g, '/');

/** Reverse-proxies to `origin`, mounting the visitor's path under `prefix`. */
async function proxy(request, origin, prefix, extraHeaders) {
  const url = new URL(request.url);
  const target = new URL(origin);
  target.pathname = joinPath(prefix || '', url.pathname);
  target.search = url.search;

  const upstream = new Request(target.toString(), request);
  upstream.headers.set('x-forwarded-host', url.hostname);
  upstream.headers.set('x-forwarded-proto', 'https');
  upstream.headers.delete('cookie');

  let res = await fetch(upstream, { redirect: 'manual' });

  // Static hosts redirect /dir to /dir/. Rewrite Location back out of the
  // prefix so the visitor stays on the subdomain instead of being sent to the
  // bare origin.
  const location = res.headers.get('location');
  if (location && prefix) {
    try {
      const loc = new URL(location, target);
      if (loc.hostname === target.hostname && loc.pathname.startsWith(prefix)) {
        const rewritten = new URL(url.toString());
        rewritten.pathname = loc.pathname.slice(prefix.length) || '/';
        rewritten.search = loc.search;
        const headers = new Headers(res.headers);
        headers.set('location', rewritten.toString());
        res = new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      }
    } catch { /* unparseable Location: leave it alone */ }
  }

  return withHeaders(res, extraHeaders);
}

async function notFound(hubOrigin) {
  const res = await fetch(hubOrigin + '/404.html');
  const headers = new Headers(SECURITY_HEADERS);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(res.status === 200 ? res.body : 'nothing parked here', { status: 404, headers });
}

export default {
  async fetch(request, env) {
    const hub = 'https://' + env.ORIGIN_HOST;
    const domain = (env.DOMAIN || table.domain).toLowerCase();
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();

    if (host === 'www.' + domain) {
      url.hostname = domain;
      return Response.redirect(url.toString(), 301);
    }

    if (host === domain) return proxy(request, hub, '', { 'x-stuntcamp': 'hub' });

    const slug = slugOf(host, domain);
    const route = slug ? table.routes[slug] : null;
    if (!route) return notFound(hub);

    if (route.kind === 'redirect') {
      const target = new URL(route.url);
      target.pathname = joinPath(target.pathname, url.pathname);
      target.search = url.search;
      return Response.redirect(target.toString(), 301);
    }

    if (route.kind === 'proxy') {
      const base = new URL(route.url);
      return proxy(request, base.origin, base.pathname.replace(/\/$/, ''), { 'x-stuntcamp': slug });
    }

    return proxy(request, hub, route.path, { 'x-stuntcamp': slug });
  },
};
