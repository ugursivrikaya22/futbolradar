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
/**
 * MİGRASYON 0014 UYGULANMAMIŞ OLABİLİR. `notification_types` /
 * `last_match_day_on` sütunları yoksa PostgREST 400 (PGRST204 / 42703)
 * döner; bu durumda istek ESKİ sütunlarla tekrarlanır. Böylece migrasyon
 * gelmeden de abonelik ve gol bildirimi bugünkü gibi çalışır — yalnızca
 * tür tercihi ve maç günü tekilleştirmesi devre dışı kalır.
 */
function isMissingColumnError(error) {
  const message = String((error && error.message) || "");
  return /http-400/.test(message) && /(notification_types|last_match_day_on|PGRST204|42703|column)/i.test(message);
}

async function saveSubscription({ endpoint, p256dh, auth, favoriteTeam, userAgent, notificationTypes }) {
  const base = {
    endpoint,
    p256dh,
    auth,
    favorite_team: favoriteTeam,
    user_agent: userAgent ? String(userAgent).slice(0, 300) : null,
    updated_at: new Date().toISOString()
  };
  const request = (body) => supabaseRequest(`${TABLE}?on_conflict=endpoint`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(body)
  });
  if (notificationTypes === undefined) return request(base);
  try {
    return await request({ ...base, notification_types: notificationTypes });
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
    return request(base);
  }
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
  const base = `${TABLE}?favorite_team=eq.${encodeURIComponent(favoriteTeam)}&select=endpoint,p256dh,auth`;
  let rows;
  try {
    rows = await supabaseRequest(`${base},notification_types,last_match_day_on`, { method: "GET" });
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
    rows = await supabaseRequest(base, { method: "GET" });
  }
  return Array.isArray(rows) ? rows : [];
}

/**
 * Maç günü hatırlatması gönderildi damgası (İstanbul tarihi, YYYY-AA-GG).
 * Uç nokta gün içinde iki kez çağrılsa bile aynı abone ikinci kez almaz.
 * Sütun yoksa (migrasyon 0014 uygulanmamış) `false` döner; tekilleştirme
 * o zaman yalnızca bildirim `tag`ına kalır.
 */
async function markMatchDaySent(endpoint, isoDate) {
  try {
    await supabaseRequest(`${TABLE}?endpoint=eq.${encodeURIComponent(endpoint)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ last_match_day_on: isoDate, last_sent_at: new Date().toISOString() })
    });
    return true;
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
    await markSent(endpoint);
    return false;
  }
}

/** Başarılı gönderim sonrası teşhis damgası (bkz. migrasyon `last_sent_at`). */
async function markSent(endpoint) {
  await supabaseRequest(`${TABLE}?endpoint=eq.${encodeURIComponent(endpoint)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ last_sent_at: new Date().toISOString() })
  });
}

module.exports = {
  TABLE,
  configurationHint,
  isConfigured,
  isMissingColumnError,
  listByTeam,
  markMatchDaySent,
  markSent,
  removeSubscription,
  saveSubscription
};
