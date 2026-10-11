# Vercel deployment and runtime cost controls

Production remains on `main`. Automatic previews are opt-in: use a branch
under `preview/` when a hosted preview is needed. Other branches can still
run GitHub checks; they do not need a Vercel deployment for every push.
Existing branches must receive this configuration before it can govern
their builds. The ignore command also checks the preview branch, while
missing comparison metadata fails open to preserve publication.

Private editorial approval files, documentation and operational outputs
alone do not deploy. News, fixtures, public assets, sitemap, runtime code
and configuration changes still do. The comparison remains against the
previous deployment, not only the last commit, so a later documentation
commit cannot conceal a pending public update.

The hourly and daily schedules, persisted ledger, daily compensation,
single-writer lock, validation and publication monitoring are unchanged.
An unchanged update already creates no public commit. A changed static
news or SEO page still requires deployment; skipping those builds without
a verified alternative publication path would leave the site stale.

Runtime changes cache only the pure timestamp-to-Istanbul-day conversion
(bounded to 8,192 entries). Live responses, provider data, current time and
live freshness verdicts are not cached. Match detail normalizes only the
selected record; match lists normalize only the requested date/league.
Live HTTP and SSE cache headers remain `no-store`.

Validation: `npm run test:cost`, `npm run test:operations`, and the existing
live-score, provider, fixture, news and SEO checks. Runtime tests compare
full response objects and count normalization/conversion work, rather than
asserting hardware-dependent timing.

No build machine, concurrency, subscription, retention or provider quota
setting is changed by this patch. No social content is published.

Rollback: revert this change. No migration, data deletion or external
service is involved.

References:
- [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration)
- [Vercel build management](https://vercel.com/docs/builds/managing-builds)
