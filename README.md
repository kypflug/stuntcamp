# stuntcamp

A place to park stunt apps. Small, strange, single-purpose web things —
some hosted here, some just linked. Every one gets a subdomain.

**https://stuntcamp.app**

Want to park something? See [docs/ADDING-AN-APP.md](docs/ADDING-AN-APP.md).
It's one JSON file and a pull request.

## How it works

```
              Cloudflare (DNS + TLS + Worker router)
                              |
  stuntcamp.app ──────────────┤  worker/routes.json, generated from the registry
  *.stuntcamp.app ────────────┤
                              |
     ┌────────────────────────┼──────────────────────────┐
     |                        |                          |
  hub index             hosted apps                external origins
  SWA /                 SWA /a/<slug>/             301 redirect or reverse proxy
     └──── Azure Static Web App (Free tier) ────┘
```

- The **registry** (`registry/apps/*.json`) is the single source of truth. One
  file per app, validated in CI.
- The **hub** (`hub/build.mjs`) renders the index from the registry. Zero
  dependencies, static output, no runtime JavaScript.
- The **pipeline** (`scripts/build-apps.mjs`) resolves each hosted app into
  `dist/a/<slug>/`, whether it comes from this repo, a source build, or a
  prebuilt artifact.
- The **Worker** (`worker/src/index.js`) is the only public front door. It maps
  each hostname to a path on the Static Web App, an external redirect, or a
  proxy. Cloudflare's free Universal SSL covers the apex and one wildcard
  level, so no per-app certificate or Azure custom domain is needed.

Everything runs on free tiers.

## Layout

```
registry/apps/<slug>.json   one manifest per app — the only file contributors add
registry/site.json          domain, blurb, reserved slugs
registry/schema.json        JSON Schema for editor autocomplete
hub/build.mjs               registry -> dist/index.html
hub/style.css               the whole design
hub/assets/fonts/           self-hosted Space Grotesk/Plex faces (SIL OFL, licence alongside)
hub/assets/ridge*.jpg       the ridgeline painting the wordmark is cut out of, plus its ladder
apps/<slug>/                source for in-repo apps
scripts/registry.mjs        shared loader + validator
scripts/build-apps.mjs      manifests -> dist/a/<slug>/
scripts/build-routes.mjs    manifests -> worker/routes.json
scripts/screenshot.mjs      Playwright thumbnails
scripts/images.mjs          sharp AVIF + JPEG ladders for cards and the wordmark art
scripts/og-image.mjs        Playwright social card -> hub/assets/og.jpg
scripts/serve.mjs           local preview with subdomain routing
worker/                     Cloudflare Worker + wrangler config
infra/main.bicep            resource group + Static Web App
```

## Commands

```bash
npm run validate     # check every manifest
npm run build        # hub + apps + routing table -> dist/
npm run check        # same, but a failing app fails the run
npm run serve        # preview at http://localhost:8787 and http://<slug>.localhost:8787
npm run shots        # refresh thumbnails from the live site (needs playwright)
npm run images       # cut the AVIF + JPEG ladders for cards and the wordmark art (needs sharp)
npm run og          # regenerate the social card (needs playwright)
```

`npm run build` needs nothing installed beyond Node 20+, git and curl. Only the
thumbnail job and the Worker deploy have dependencies.

## Deploying

Pushes to `main` run `.github/workflows/deploy.yml`, which builds everything,
uploads `dist/` to the Static Web App, and deploys the Worker. A nightly run
picks up upstream changes for any app tracking a branch.

Two repository secrets are required:

| Secret | Where it comes from |
| --- | --- |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | `az staticwebapp secrets list --name swa-stuntcamp --resource-group rg-stuntcamp --query properties.apiKey -o tsv` |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Workers Scripts: Edit, and DNS / Workers Routes / Zone Settings: Edit on the zone |
| `THUMBNAILS_APP_CLIENT_ID` | Client ID of the `stuntcamp-thumbnails` GitHub App. See [Thumbnails](#thumbnails). |
| `THUMBNAILS_APP_PRIVATE_KEY` | Private key generated for that same app. |

Infrastructure is one resource group and one Free-tier Static Web App:

```bash
az group create --name rg-stuntcamp --location westus2
az deployment group create --resource-group rg-stuntcamp --template-file infra/main.bicep
```

## Thumbnails

After every successful deploy, `.github/workflows/thumbnails.yml` re-captures each
app from the live site, opens a pull request with whatever changed, and merges it.

Getting that pull request to merge takes one deliberate piece of plumbing, because
`GITHUB_TOKEN` alone cannot do it:

- **It cannot start `validate`.** GitHub parks any workflow run whose triggering
  event came from `GITHUB_TOKEN`, to stop workflows retriggering themselves. The run
  is created but never executes, so the required check never reports and the merge is
  refused indefinitely. The symptom is a pull request with a check *suite* stuck at
  `action_required` and no check *runs* at all.
- **It cannot bypass the rule either.** Bypass actors of type `Integration` are only
  available to organisation-owned repositories, and this one belongs to a user — the
  API rejects the attempt outright with *"Actor GitHub Actions integration must be
  part of the ruleset source or owner organization"*.

So the job mints an installation token for the **`stuntcamp-thumbnails` GitHub App**
and opens the pull request as that app. An app is an ordinary actor, so the
`pull_request` event fires normally, `validate` runs for real, and the merge proceeds
on its own merits. Nothing is waved through: the bot clears exactly the same bar as a
human contributor.

The app is **not** a ruleset bypass actor and cannot be made one, which is the point
— `main` is no more writable by the bot than by anyone else.

> Do not reach for a deploy key here. On a user-owned repository a deploy key is
> attributed to the repository owner, who holds an admin bypass over the ruleset, so
> a write deploy key can push straight to `main` — `Bypassed rule violations` — and
> skips `validate` entirely. It looks like a narrowly scoped credential and is in
> fact an admin-equivalent one.

### Setting up the app

1. Create a GitHub App under your account (**Settings → Developer settings → GitHub
   Apps → New GitHub App**). Homepage URL can be this repository; uncheck **Webhook →
   Active**.
2. Give it exactly two repository permissions: **Contents: Read and write** and
   **Pull requests: Read and write**.
3. Install it on this repository only.
4. Put the Client ID in `THUMBNAILS_APP_CLIENT_ID` and a generated private key in
   `THUMBNAILS_APP_PRIVATE_KEY`.

To rotate, generate a fresh private key on the app and replace
`THUMBNAILS_APP_PRIVATE_KEY`.

### Why the merge stays on `GITHUB_TOKEN`

The merge is the one step that deliberately does *not* use the app token. Because a
`GITHUB_TOKEN` merge raises no `push` event, it ends the chain rather than starting
another deploy, and fresh thumbnails ship with the next one. Merging as the app would
loop on every capture that is not byte-identical, and would need `[skip ci]` or a
`paths-ignore` guard to stay safe.

## Trust model

`source-build` runs contributor build scripts in CI, so:

- pull request validation runs with **no secrets** and a read-only token,
- only merges to `main` can deploy,
- `build.ref` should be a pinned commit SHA, and the validator warns when it
  isn't,
- `artifact` exists for anyone who would rather we never execute their build.

The thumbnail bot is held to the same line: it opens a pull request like anyone else,
and `validate` gates its merge. See [Thumbnails](#thumbnails).
