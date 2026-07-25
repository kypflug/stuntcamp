# Adding an app

Everything on stuntcamp is one JSON file in `registry/apps/`. Open a pull
request that adds `registry/apps/<slug>.json` and that's the whole process. CI
validates it, builds it, and once it merges your app answers on
`https://<slug>.stuntcamp.app`.

You do not need an Azure account, a Cloudflare account, or any secrets.

## The short version

```jsonc
{
  "$schema": "../schema.json",
  "slug": "my-thing",
  "name": "my thing",
  "tagline": "One line about what it does.",
  "type": "source-build",
  "author": { "name": "you", "url": "https://github.com/you" },
  "source": "https://github.com/you/my-thing",
  "build": {
    "repo": "you/my-thing",
    "ref": "<40-char commit sha>",
    "install": "npm ci",
    "command": "npm run build",
    "output": "dist"
  },
  "tags": ["toy"],
  "accent": "#4fc3f7",
  "added": "2026-07-25"
}
```

The filename must match the slug: `my-thing.json` for slug `my-thing`.
The slug becomes a subdomain, so it has to be a single DNS label — lowercase
letters, digits and hyphens. `a.b` will not work, because Cloudflare's free
certificate only covers one level below `stuntcamp.app`.

## Pick a type

| `type` | Use it when | What happens |
| --- | --- | --- |
| `source-build` | You have a public GitHub repo we can build | CI clones it at a pinned ref, runs your build, serves the output |
| `artifact` | You'd rather build it yourself | CI downloads a release asset or a `gh-pages`-style branch |
| `in-repo` | It's a couple of files with no real home | Commit them under `apps/<slug>/` in this repo |
| `redirect` | It already lives somewhere else | `<slug>.stuntcamp.app` 301s to your URL |
| `proxy` | Same, but you want the stuntcamp address to stick | We reverse-proxy your origin |
| `link` | It isn't a website at all (extension, CLI, library) | Index card only, no subdomain |

### source-build

```jsonc
"build": {
  "repo": "you/my-thing",       // owner/name on GitHub, must be public
  "ref": "a1b2c3...",           // pin to a commit SHA
  "install": "npm ci",          // optional; omit if you have no dependencies
  "command": "npm run build",   // required
  "output": "dist"              // directory containing index.html; "." for repo root
}
```

The build runs on `ubuntu-latest` with Node 22 and Python 3.12 available. It
must finish without network access to anything but your package registry, and
it must produce an `index.html` in `output`.

`ref` should be a full 40-character commit SHA. A branch name works and gets
picked up by the nightly rebuild, but you'll get a warning: pinning is what
stops an upstream force-push from silently changing what we publish.

Only use `install: "npm ci"` if your repo has a `package-lock.json`. If it
doesn't, use `npm install` or omit `install` entirely.

### artifact

Build in your own CI and let us mirror the result.

```jsonc
// from a release asset
"build": { "repo": "you/my-thing", "artifact": "release", "release": "latest", "asset": "dist.zip" }

// from a branch holding prebuilt files
"build": { "repo": "you/my-thing", "artifact": "branch", "branch": "gh-pages", "output": "." }
```

### in-repo

Commit your files to `apps/<slug>/` in this repo. Add a `build` block only if
they need a build step; otherwise the files are served as-is.

### redirect / proxy / link

```jsonc
{ "type": "redirect", "url": "https://my-thing.example" }
```

`redirect` sends visitors to your address and keeps the path
(`my-thing.stuntcamp.app/docs` → `my-thing.example/docs`). `proxy` serves your
origin under the stuntcamp address instead. `link` puts a card on the index
with no subdomain at all.

## Fields

| Field | Required | Notes |
| --- | --- | --- |
| `slug` | yes | Single DNS label. Becomes the subdomain. Must match the filename. |
| `name` | yes | Display name on the card. |
| `tagline` | yes | One line, 160 characters max. |
| `type` | yes | One of the six above. |
| `note` | no | A second, longer line on the card. 240 characters max. |
| `author` | no | `{ "name", "url" }`. Credits you on the card. |
| `source` | no | Repo or project URL, linked from the card. |
| `url` | for redirect/proxy/link | Where it actually lives. |
| `build` | for source-build/artifact | See above. |
| `tags` | no | Up to 6 short strings. |
| `accent` | no | `#rrggbb`. Tints the card. |
| `thumbnail` | no | Path or URL. Leave it out and we screenshot the live app. |
| `added` | no | `YYYY-MM-DD`. |
| `visible` | no | Set `false` to keep it in the registry but off the index. |

## Thumbnails

Leave `thumbnail` unset. After each deploy a Playwright job visits every live
app at 1280×800 and commits the screenshot to `hub/assets/thumbs/<slug>.png`.
Set `thumbnail` only if you want something hand-made.

## What CI does to your PR

The `validate` workflow runs with **no secrets and a read-only token**, so a
pull request from a fork can never publish anything. It:

1. validates every manifest,
2. builds the hub index,
3. builds every hosted app in strict mode — your build has to succeed,
4. generates the routing table.

After merge, `deploy` runs the same build with credentials and publishes. In
the deploy run a failing app is isolated: it gets a "between takes" placeholder
instead of breaking everyone else's site.

## Serving details worth knowing

Hosted apps live at `/a/<slug>/` on the origin, but the Worker mounts that at
the root of your subdomain, so root-absolute URLs like `/style.css` work fine
on `<slug>.stuntcamp.app`. Relative URLs are still the safer habit.

Single-page apps that need a catch-all rewrite aren't supported yet — deep
links will 404. Open an issue if you need one.

`.git`, `.github`, `node_modules`, `.vscode`, `.idea` and anything starting
with `.env` are stripped from your output before publishing. Everything else in
`output` is served publicly, so if you point `output` at your repo root, expect
your source files to be readable.

Cloudflare injects its Web Analytics beacon into every HTML page served from
the zone. It's a single `<script>` tag from `static.cloudflareinsights.com`.
Worth knowing if your app advertises itself as JavaScript-free — the page you
authored has no script, but the page visitors receive has one.

## Try it locally

No install required:

```bash
node scripts/validate-registry.mjs   # check your manifest
npm run build                        # hub + apps + routes
npm run serve                        # http://<slug>.localhost:8787/
```
