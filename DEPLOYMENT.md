# FutbolRadar Vercel Deploy

## Project root

Deploy this directory as the Vercel project root:

`futbolradar-ana-sayfas-n-ba-tan`

The root must contain `index.html`, `page.css`, `app.js`, `api/`, `data/`, `sitemap.xml`, `robots.txt`, and `.env.example`.

## Vercel settings

- Framework Preset: Other
- Build Command: leave empty
- Output Directory: leave empty
- Install Command: leave empty

`vercel.json` keeps `.html` URLs stable:

```json
{
  "cleanUrls": false,
  "trailingSlash": false
}
```

## Environment variables

Set these only in the Vercel dashboard. Do not commit real API keys.

```text
FOOTBALL_API_PROVIDER=football-data
FOOTBALL_API_KEY=
FOOTBALL_API_BASE_URL=https://api.football-data.org/v4
FOOTBALL_COMPETITION_CODE=TSL
```

`FOOTBALL_API_KEY` is the preferred key name. The API layer also accepts these
aliases so an existing Vercel variable can still activate the live provider:

```text
FOOTBALL_DATA_API_KEY
FOOTBALLDATA_API_KEY
FOOTBALL_DATA_ORG_API_KEY
FOOTBALL_DATA_AUTH_TOKEN
FOOTBALL_DATA_TOKEN
FOOTBALLDATA_TOKEN
FOOTBALL_API_TOKEN
```

The base URL and competition code also have safe aliases:

```text
FOOTBALL_DATA_BASE_URL
FOOTBALLDATA_BASE_URL
FOOTBALL_DATA_COMPETITION_CODE
FOOTBALLDATA_COMPETITION_CODE
COMPETITION_CODE
```

After changing Vercel variables, create a new Production deployment. Serverless
functions only see the updated environment after a fresh deployment.

## Live API health check

Use `/api/health` after deployment. It never returns the secret value, only
whether an accepted environment variable name is present.

- `apiKeyConfigured: true`: `/api/matches` and `/api/standings` can use the live provider.
- `apiKeyConfigured: false`: live provider is not visible to Production, so the site uses Mock API data.
- `baseUrlConfigured: true`: the default or configured football-data base URL is active.
- `competitionCodeConfigured: true`: the default or configured competition code is active.

## Post-deploy QA

Check these pages:

- `/`
- `/puan-durumu.html`
- `/takimlar.html`
- `/oyuncu-radari.html`
- `/canli-skor.html`
- `/bugunun-maclari.html`
- `/momentum.html`
- `/analizler.html`
- `/sitemap.xml`
- `/robots.txt`

Check these API routes:

- `/api/matches`
- `/api/standings`
- `/api/teams`
- `/api/players`
- `/api/momentum`
- `/api/signals`
- `/api/analyses`
- `/api/health`

Expected API response shape:

```json
{
  "ok": true,
  "source": "FutbolRadar Mock API or FutbolRadar Live API",
  "updatedAt": "ISO date",
  "data": []
}
```
