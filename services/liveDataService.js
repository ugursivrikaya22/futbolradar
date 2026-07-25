const { getProviderChain } = require("./providers");
const { providerLeagueValue } = require("./competitionCatalog");
const { withTimeout } = require("../api/_utils");

// A serverless request has a hard wall-clock limit, so the whole failover
// chain shares one budget instead of every provider getting the full
// DEFAULT_TIMEOUT_MS. A slow first provider therefore shortens - never
// cancels - the attempt on the next one.
const TOTAL_BUDGET_MS = 8000;
const MAX_PROVIDER_TIMEOUT_MS = 3500;
const MIN_PROVIDER_TIMEOUT_MS = 800;

// Errors that say "this provider can never answer this request" (bad plan,
// missing credential, unsupported query). Retrying is pointless; the chain
// should move on immediately. Everything else is treated as transient.
const PERMANENT_ERROR_CODES = new Set([
  "PROVIDER_ACCOUNT_SUSPENDED",
  "PROVIDER_AUTH_ERROR",
  "PROVIDER_CONFIG_MISSING",
  // Anahtar header'a hic konmamissa yeniden denemek de fayda etmez; ortam
  // degiskeni duzeltilene kadar kalici bir kurulum hatasidir.
  "PROVIDER_CREDENTIAL_NOT_SENT",
  "PROVIDER_PLAN_ERROR",
  "PROVIDER_QUERY_MISSING",
  "LIVE_PROVIDER_NOT_IMPLEMENTED"
]);

// Bir sağlayıcı hesap/paket düzeyinde reddedince her istekte tekrar
// denemenin faydası yok: yanıta gereksiz gecikme ekler ve sağlayıcının
// kota sayacını boşuna harcar. Kısa süreli, süreç içi devre kesici; her
// yeni lambda örneğinde ve süre dolduğunda kendiliğinden iyileşir.
const DISABLED_PROVIDER_TTL_MS = 5 * 60 * 1000;
const disabledProviders = new Map();

function disableProvider(resource, providerName) {
  disabledProviders.set(`${resource}:${providerName}`, Date.now() + DISABLED_PROVIDER_TTL_MS);
}

function isProviderDisabled(resource, providerName) {
  const until = disabledProviders.get(`${resource}:${providerName}`);
  if (!until) {
    return false;
  }

  if (until <= Date.now()) {
    disabledProviders.delete(`${resource}:${providerName}`);
    return false;
  }

  return true;
}

function resetProviderHealth() {
  disabledProviders.clear();
}

function errorAttempt(error, includeDetail) {
  const attempt = {
    status: "error",
    code: error && error.code ? error.code : "PROVIDER_ERROR",
    // Provider messages are already user-facing Turkish strings built by the
    // adapters; they never contain credentials or stack traces.
    message: error && error.message ? String(error.message).slice(0, 200) : "Bilinmeyen provider hatasi.",
    permanent: PERMANENT_ERROR_CODES.has(error && error.code)
  };

  // `?debug=1` adds the provider's own error body. Adapters classify errors
  // into our own codes, which loses the vendor wording - and that wording
  // ("Free plans do not have access to this season") is exactly what tells
  // an operator whether the fix is a key, a plan or a query. Off by default
  // so a normal response stays lean; the body is provider-authored error
  // text, never request headers, so no credential can appear here.
  if (includeDetail && error) {
    attempt.httpStatus = error.statusCode || null;
    attempt.detail = error.raw === undefined || error.raw === null
      ? null
      : String(typeof error.raw === "string" ? error.raw : JSON.stringify(error.raw)).slice(0, 400);
  }

  return attempt;
}

/**
 * Walks the provider chain for `resource` and returns the first usable
 * result. Providers that throw or return nothing are recorded in
 * `attempts` and the walk continues, so one broken provider can no longer
 * blank out a whole page.
 *
 * @param {object} options
 * @param {string} options.resource   Provider-chain key (e.g. "matches").
 * @param {(provider: object, providerQuery: object) => Promise<any>} options.run
 * @param {object} [options.query]    Raw request query; league values are
 *                                    translated per provider.
 * @param {(data: any) => boolean} [options.isUsable]
 */
async function resolveFromProviders({ resource, run, query, isUsable }) {
  const chain = getProviderChain(resource);
  const attempts = [];
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const usable = isUsable || ((data) => Array.isArray(data) && data.length > 0);
  const includeDetail = Boolean(query && String(query.debug) === "1");
  let fallback = null;

  for (const [index, provider] of chain.entries()) {
    const attempt = { provider: provider.name };
    // Zincirin son halkası kürasyonlu veridir: ağ isteği yapmaz, bu yüzden
    // zaman bütçesi gerekçesiyle atlanmamalı - atlanırsa sayfa elimizde
    // hazır veri dururken boş kalırdı.
    const isLastResort = index === chain.length - 1;
    const requestedLeague = query && query.league ? String(query.league) : "";
    const providerLeague = requestedLeague ? providerLeagueValue(requestedLeague, provider.name) : "";

    // A catalogued competition the provider has no id for (e.g. the Europa
    // League on football-data.org) is a skip, not a failure - the next
    // provider in the chain may well cover it.
    if (requestedLeague && providerLeague === null) {
      attempt.status = "skipped";
      attempt.code = "COMPETITION_NOT_SUPPORTED";
      attempts.push(attempt);
      continue;
    }

    // `?debug=1` devre kesiciyi atlar. Teşhis anında operatörün görmek
    // istediği şey sağlayıcının o anki gerçek cevabıdır; beş dakika önce
    // alınmış bir karar yüzünden "skipped" görmek, anahtar/plan düzeltmesi
    // yapıldıktan sonra durumu doğrulamayı imkânsız kılıyordu.
    if (!isLastResort && !includeDetail && isProviderDisabled(resource, provider.name)) {
      attempt.status = "skipped";
      attempt.code = "PROVIDER_TEMPORARILY_DISABLED";
      attempts.push(attempt);
      continue;
    }

    const remaining = deadline - Date.now();
    if (remaining < MIN_PROVIDER_TIMEOUT_MS && attempts.length && !isLastResort) {
      attempt.status = "skipped";
      attempt.code = "TIME_BUDGET_EXHAUSTED";
      attempts.push(attempt);
      continue;
    }

    const providerQuery = {
      ...(query || {}),
      requestedCompetition: requestedLeague,
      league: providerLeague
    };

    try {
      const data = await withTimeout(
        Promise.resolve().then(() => run(provider, providerQuery)),
        Math.min(MAX_PROVIDER_TIMEOUT_MS, Math.max(MIN_PROVIDER_TIMEOUT_MS, remaining))
      );
      attempt.count = Array.isArray(data) ? data.length : data ? 1 : 0;

      if (usable(data)) {
        attempt.status = "ok";
        attempts.push(attempt);
        return { data, provider, attempts, degraded: attempts.length > 1 };
      }

      attempt.status = "empty";
      if (!fallback) {
        fallback = { data, provider };
      }
    } catch (error) {
      Object.assign(attempt, errorAttempt(error, includeDetail));
      if (attempt.permanent) {
        disableProvider(resource, provider.name);
      }
      logProviderFailure(resource, attempt);
    }

    attempts.push(attempt);
  }

  if (fallback) {
    return { data: fallback.data, provider: fallback.provider, attempts, degraded: true };
  }

  return { data: null, provider: null, attempts, degraded: true };
}

/**
 * Sağlayıcı hataları sunucu loguna tek satır olarak düşer. Yanıttaki `meta`
 * yalnızca o isteği yapan kişiye görünür; kesinti sırasında geriye dönük
 * bakılabilecek bir iz de gerekiyor. Mesajlar adaptörlerde üretilen kullanıcıya
 * dönük metinlerdir, kimlik bilgisi taşımaz.
 */
function logProviderFailure(resource, attempt) {
  const parts = [
    `resource=${resource}`,
    `provider=${attempt.provider}`,
    `code=${attempt.code}`,
    attempt.permanent ? "permanent=true" : null,
    attempt.message ? `message=${JSON.stringify(attempt.message)}` : null
  ].filter(Boolean);
  console.warn(`[futbolradar:provider-failure] ${parts.join(" ")}`);
}

/**
 * Compact, credential-free trace of the failover walk. Shipped on every
 * response so a provider outage is visible from the API itself instead of
 * requiring a debug redeploy.
 */
function providerMeta(result, extra) {
  return {
    provider: result.provider ? result.provider.name : null,
    degraded: Boolean(result.degraded),
    attempts: result.attempts,
    ...(extra || {})
  };
}

module.exports = {
  DISABLED_PROVIDER_TTL_MS,
  MAX_PROVIDER_TIMEOUT_MS,
  PERMANENT_ERROR_CODES,
  TOTAL_BUDGET_MS,
  providerMeta,
  resetProviderHealth,
  resolveFromProviders
};
