/**
 * PUSH BİLDİRİMİ ABONELİK DEPOSU — SUPABASE.
 *
 * `services/homePollVoteStore.js` ile aynı desen: `@supabase/supabase-js`
 * yerine PostgREST'e düz `fetch`, kimlik bilgisi `services/supabase/env.js`
 * üzerinden tek noktadan okunuyor. Şema: `supabase/migrations/
 * 0003_push_subscriptions.sql`.
 *
 * DEPO YOKSA ABONELİK KABUL EDİLMEZ. `/api/push-subscribe` bu durumda
 * "yapılandırılmamış" döner; istemci bildirim iznini hiç istemez —
 * kullanıcıya izin verdirip sonra sessizce hiçbir şey göndermemekten iyi.
 */

const {
  isConfigured,
  configurationHint,
  restUrl,
  serviceKey
} = require("./supabase/env");

const TABLE = "push_subscriptions";
const REQUEST_TIMEOUT_MS = 4000;

async function supabaseRequest(pathname, options = {}) {
  const base = restUrl();
  const key = serviceKey();
  if (!base || !key) throw new Error("push-subscription-store-not-configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${base}/rest/v1/${pathname}`, {
      ...options,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      signal: controller.signal
    });

    const raw = await response.text();

    if (!response.ok) {
      let detail = "";
      try {
        const parsed = JSON.parse(raw);
        detail = String((parsed && (parsed.message || parsed.hint || parsed.code)) || "").slice(0, 200);
      } catch (error) {
        detail = raw.slice(0, 200);
      }
      throw new Error(`push-subscription-store-http-${response.status}${detail ? `: ${detail}` : ""}`);
    }

    return raw ? JSON.parse(raw) : [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Abonelik kaydet ya da güncelle.
 *
 * `on_conflict=endpoint` + `resolution=merge-duplicates`: aynı cihaz favori
 * takımını değiştirdiğinde yeni satır açmak yerine mevcut satır güncellenir
 * (bkz. migrasyon dosyasındaki gerekçe).
 */
async function saveSubscription({ endpoint, p256dh, auth, favoriteTeam, favoriteTeams, notificationTypes, userAgent }) {
  await supabaseRequest(`${TABLE}?on_conflict=endpoint`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      endpoint,
      p256dh,
      auth,
      favorite_team: favoriteTeam,
      favorite_teams: favoriteTeams || [favoriteTeam],
      notification_types: require("./pushPreferences").normalizeTypes(notificationTypes),
      user_agent: userAgent ? String(userAgent).slice(0, 300) : null,
      updated_at: new Date().toISOString()
    })
  });
}

/** Abonelik sil — kullanıcı bildirimi kapattığında ya da push servisi 404/410 döndürdüğünde. */
async function removeSubscription(endpoint) {
  await supabaseRequest(`${TABLE}?endpoint=eq.${encodeURIComponent(endpoint)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
}

/** Bir takımın tüm aboneleri — gol/maç başı bildirimi göndermeden önce okunur. */
async function listByTeam(favoriteTeam) {
  const query = `${TABLE}?or=(favorite_team.eq.${encodeURIComponent(favoriteTeam)},favorite_teams.cs.{${encodeURIComponent(favoriteTeam)}})&select=endpoint,p256dh,auth,notification_types`;
  const rows = await supabaseRequest(query, { method: "GET" });
  return Array.isArray(rows) ? rows : [];
}

/** Başarılı gönderim sonrası teşhis damgası (bkz. migrasyon `last_sent_at`). */
async function markSent(endpoint) {
  await supabaseRequest(`${TABLE}?endpoint=eq.${encodeURIComponent(endpoint)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ last_sent_at: new Date().toISOString() })
  });
}

async function listAll() {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await supabaseRequest(`${TABLE}?select=favorite_team,favorite_teams&order=id&limit=1000&offset=${offset}`, {method:"GET"});
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

module.exports = {
  listAll,
  TABLE,
  configurationHint,
  isConfigured,
  listByTeam,
  markSent,
  removeSubscription,
  saveSubscription
};
