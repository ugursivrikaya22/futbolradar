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

Expected API response shape:

```json
{
  "ok": true,
  "source": "FutbolRadar Mock API or FutbolRadar Live API",
  "updatedAt": "ISO date",
  "data": []
}
```
