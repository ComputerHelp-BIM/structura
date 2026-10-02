# Structura — ETABS Viewer (v1.8.1)

Browser-based ETABS model viewer by **Computer Help / Building Software**.
Pure static site: HTML + JavaScript, no build step, no server code, no database.
Model files are parsed in the visitor's browser and never uploaded.

## Project structure

```
structura-vercel/
├── index.html          App shell (markup + all CSS)
├── favicon.svg
├── vercel.json         Security headers, caching, clean URLs
├── package.json        Version + helper scripts (no dependencies)
├── js/                 Application modules (parser, viewer, UI, exports…)
│   └── parse-worker.js Web Worker — parses big files off the main thread
├── vendor/             Self-hosted libraries (no CDN dependency)
│   ├── three.r128.min.js        3-D rendering        (MIT)
│   ├── jspdf-2.5.1.umd.min.js   PDF report, lazy     (MIT)
│   └── xlsx-0.18.5.full.min.js  .xlsx import, lazy   (Apache-2.0)
└── scripts/check.js    Pre-deploy sanity check
```

## Run locally

```bash
npm run dev        # http://localhost:3000
```
Use a local server, not a double-clicked `index.html` — browsers block Web Workers on `file://`.

## Deploy to Vercel

### Option A — GitHub + Vercel dashboard (recommended)
1. Create a GitHub repository and push this folder to it.
2. vercel.com → **Add New… → Project** → import the repository.
3. Settings: **Framework Preset: Other**, **Build Command: empty**, **Output Directory: `.`** (root), **Install Command: empty**.
4. **Deploy.** Every push to `main` redeploys; every pull request gets a preview URL.

### Option B — Vercel CLI
```bash
npm i -g vercel
vercel login
vercel            # first run: links the project and creates a preview deployment
vercel --prod     # production
```

### Custom domain (e.g. viewer.buildingsoftware.in)
Vercel → Project → **Settings → Domains → Add** `viewer.buildingsoftware.in`, then at your DNS provider add
`CNAME  viewer  cname.vercel-dns.com`. HTTPS is issued automatically.

## Releasing a new version
1. Bump `VERSION` in `js/app-core.js` **and** `version` in `package.json` (semantic versioning: MAJOR.MINOR.PATCH).
2. Add the release notes in `js/guide.js` (`RELEASES`).
3. `npm run check` — must print “ready to deploy”.
4. Commit, tag (`git tag v1.4.1`), push.

## Notes
- `js/` is cached for 5 minutes, `vendor/` for a year (file names carry versions — rename when upgrading a library).
- The Content-Security-Policy only allows this site plus Google Fonts. If you add analytics or another CDN, add its host to `vercel.json`.
- `.edb` / `.ebk` are binary ETABS databases; export `.e2k` from ETABS (File → Export → ETABS .e2k Text File).
