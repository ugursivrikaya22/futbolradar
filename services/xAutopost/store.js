/**
 * Paylaşılan tweet anahtarları — Supabase `x_autopost_posts`
 * (bkz. supabase/migrations/0014_x_autopost.sql). İlk INSERT kazanır:
 * aynı maç/gol/yazı iki kez paylaşılmaz, eşzamanlı iki cron çağrısı da
 * aynı anahtarı ikinci kez alamaz. `request` testte sahte istemcidir.
 */
const TABLE = "x_autopost_posts";

function defaultRequest() {
  return require("../supabase/client").request;
}

function createStore({ request = defaultRequest() } = {}) {
  return {
    async existing(keys) {
      if (!keys.length) return new Set();
      const list = keys.map((k) => `"${String(k).replace(/"/g, "")}"`).join(",");
      const rows = await request(`${TABLE}?select=post_key&post_key=in.(${encodeURIComponent(list)})`, { method: "GET" });
      return new Set((Array.isArray(rows) ? rows : []).map((r) => r.post_key));
    },
    async claim({ key, kind, text }) {
      const rows = await request(`${TABLE}?on_conflict=post_key`, {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify([{ post_key: key, kind, text, status: "pending" }])
      });
      return Array.isArray(rows) && rows.length > 0;
    },
    async finish({ key, status, tweetId = null, error = null }) {
      await request(`${TABLE}?post_key=eq.${encodeURIComponent(key)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status, tweet_id: tweetId, error: error ? String(error).slice(0, 300) : null, posted_at: status === "posted" ? new Date().toISOString() : null })
      });
    },
    /** Geçici hatada anahtarı bırakır (yalnızca kendi `pending` satırı). */
    async release(key) {
      await request(`${TABLE}?post_key=eq.${encodeURIComponent(key)}&status=eq.pending`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    },
    /** Bugün (İstanbul) gönderilen + gönderimde olan tweet sayısı — günlük tavan. */
    async countSince(iso, kind) {
      const rows = await request(`${TABLE}?select=post_key&status=in.(posted,pending)&created_at=gte.${encodeURIComponent(iso)}${kind ? `&kind=eq.${kind}` : ""}`, { method: "GET" });
      return Array.isArray(rows) ? rows.length : 0;
    }
  };
}

module.exports = { TABLE, createStore };
