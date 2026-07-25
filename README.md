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
apps/<slug>/                source for in-repo apps
scripts/registry.mjs        shared loader + validator
scripts/build-apps.mjs      manifests -> dist/a/<slug>/
scripts/build-routes.mjs    manifests -> worker/routes.json
scripts/screenshot.mjs      Playwright thumbnails
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

Infrastructure is one resource group and one Free-tier Static Web App:

```bash
az group create --name rg-stuntcamp --location westus2
az deployment group create --resource-group rg-stuntcamp --template-file infra/main.bicep
```

## Trust model

`source-build` runs contributor build scripts in CI, so:

- pull request validation runs with **no secrets** and a read-only token,
- only merges to `main` can deploy,
- `build.ref` should be a pinned commit SHA, and the validator warns when it
  isn't,
- `artifact` exists for anyone who would rather we never execute their build.
