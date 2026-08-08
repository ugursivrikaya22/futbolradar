# FutbolRadar Vercel Deploy

## Project root

Deploy this directory as the Vercel project root:

`futbolradar-ana-sayfas-n-ba-tan`

The root must contain `index.html`, `page.css`, `app.js`, `api/`, `data/`, `sitemap.xml`, `robots.txt`, and `.env.example`.

The active Production domain `www.futbolradar.com` is attached to the Vercel
project named `futbolradar`. Do not publish the production domain from the
duplicate projects `futbolradar-5l9r` or `futbolradar-ana-sayfas-n-ba-tan`.

## Vercel settings

- Framework Preset: Other
- Build Command: `npm run build`
- Output Directory: `.`
- Install Command: leave empty
- Ignored Build Step: leave empty in the dashboard; `vercel.json` forces builds to continue
- Production Branch: `main`
- Git deployments: enabled

`vercel.json` keeps `.html` URLs stable and overrides stale dashboard settings
that can block a deployment before it starts:

```json
{
  "buildCommand": "npm run build",
  "framework": null,
  "ignoreCommand": "node scripts/vercel-continue-build.mjs",
  "installCommand": "",
  "outputDirectory": ".",
  "git": {
    "deploymentEnabled": {
      "main": true
    }
  },
  "cleanUrls": false,
  "trailingSlash": false
}
```

Vercel's Ignored Build Step treats exit code `0` as "skip this deployment" and
exit code `1` as "continue building". The `scripts/vercel-continue-build.mjs`
helper exits with `1` on purpose so Production commits are not marked Blocked
because of an old dashboard ignore command.

## Commit author (deployments fail if this is wrong)

Vercel maps the **author** of the commit that triggers a deployment to a GitHub
account, and refuses to build when that account has no contributing access to
the project. A Hobby team cannot add members on a private repository, so the
only author Vercel accepts here is the project owner, `ugursivrikaya22`.

Every commit that reaches `main` must therefore be authored by:

```
ugursivrikaya22 <295430257+ugursivrikaya22@users.noreply.github.com>
```

Two places set this, and both must keep using that identity:

- `.github/workflows/match-analysis.yml` — the `Commit changes if any` step in
  both jobs. It previously used `futbolradar-bot
  <actions@users.noreply.github.com>`, which GitHub attributes to the unrelated
  account `actions`; every automated commit blocked Production.
- `.claude/hooks/session-start.sh` — sets the same identity in the repository's
  local git config for Claude Code sessions, whose container default is
  `Claude <noreply@anthropic.com>` (attributed to the account `claude`).

Check an existing commit's attribution with:

```bash
curl -s https://api.github.com/repos/ugursivrikaya22/futbolradar/commits/main \
  | grep -E '"login"|"email"'
```

A blocked deployment cannot be rescued by re-deploying: the stored commit keeps
its original author. Land a new commit authored by the owner instead. When
merging a pull request, use a merge commit or rebase rather than squash —
squashing preserves the original (wrong) author on the resulting commit.

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

Automatic repository-backed refreshes are configured separately in GitHub
Actions. See `docs/scheduled-updates.md` for schedules, required Actions
secrets, failure handling, locks, and the admin status view.

## Live API health check

Use `/api/health` after deployment. It never returns the secret value, only
whether an accepted environment variable name is present.

- `mode: "live-ready"`: Production can see an accepted API key env name.
- `mode: "mock"`: Production cannot see an accepted API key env name.
- `providerSource`: tells which provider family the API will use.
- `apiKeyConfigured: true`: `/api/matches` and `/api/standings` can use the live provider.
- `apiKeyConfigured: false`: live provider is not visible to Production, so the site uses Mock API data.
- `baseUrlConfigured: true`: the default or configured football-data base URL is active.
- `competitionCodeConfigured: true`: the default or configured competition code is active.
- `acceptedApiKeyEnvNames`: accepted Vercel variable names for the API key.
- `apiKeyEnvNamesPresent`: accepted variable names that are currently visible to the function.
- `nextAction`: short human-readable explanation of what to fix next.

If `/api/health` shows `mode: "mock"` on the live domain, check the Vercel
project's Production environment variables first. The most common causes are:

- the key exists only in Preview or Development, not Production
- the variable name is different from every accepted key name
- the variable was added after the last Production deployment
- the domain is attached to a different Vercel project than expected

After changing Vercel variables, redeploy the Production deployment. A refresh
alone is not enough for serverless functions to see new values.

## Post-deploy QA

Run local static/API checks before pushing:

```bash
npm run qa
```

Regenerate static player profile pages when `data/players.json` changes:

```bash
npm run generate:players
```

Run live checks after the Production deployment finishes:

```bash
npm run qa:live
```

The live check verifies pages, API response shape, sitemap/robots, manifest,
Open Graph image, security headers, and accidental secret exposure markers.
It uses Node's system certificate store via `node --use-system-ca`.

Check these pages:

- `/`
- `/puan-durumu.html`
- `/takimlar.html`
- `/oyuncu-radari.html`
- `/canli-skor.html`
- `/bugunun-maclari.html`
- `/momentum.html`
- `/analizler.html`
- `/oyuncular/mauro-icardi.html`
- `/oyuncular/kerem-akturkoglu.html`
- `/oyuncular/edina-dzeko.html`
- `/oyuncular/sebastian-szymanski.html`
- `/oyuncular/gedson-fernandes.html`
- `/oyuncular/ugurcan-cakir.html`
- `/oyuncular/abdulkerim-bardakci.html`
- `/oyuncular/semih-kilicsoy.html`
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
