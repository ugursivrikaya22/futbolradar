/**
 * SUPABASE İSTEK KATMANI — PostgREST'e düz `fetch`.
 *
 * BAĞIMLILIK EKLENMİYOR. `@supabase/supabase-js` kurulmuyor; bu depoda
 * bugüne kadar hiç çalışma-zamanı bağımlılığı olmadı ve veri katmanı da
 * eklemiyor. PostgREST düz HTTP: `GET /rest/v1/tablo?select=...`,
 * `POST /rest/v1/tablo` + `Prefer: resolution=merge-duplicates`.
 *
 * ---------------------------------------------------------------------
 * ANAHTAR TARAYICIYA ASLA GİTMEZ
 * ---------------------------------------------------------------------
 * Bu dosya yalnızca sunucuda çalışır. `window` görülürse modül açılışta
 * PATLAR — sessizce devre dışı kalmaz. Sebep: sessiz devre dışı kalma,
 * yanlışlıkla istemci paketine dahil edilmeyi GİZLER; anahtar bir kez
 * pakete girdiğinde çalışıp çalışmaması önemli değildir, sızmıştır.
 * Gürültülü çökme, o hatayı ilk çalıştırmada gösterir.
 *
 * Ek koruma `scripts/test-supabase-layer.mjs` içinde: istemci paketine
 * giren dosyalarda (`app.js`, `site.js`, `public/`) hiçbir Supabase
 * değişken adının geçmediği denetleniyor.
 *
 * ---------------------------------------------------------------------
 * HATA METNİ SIR TAŞIMAZ
 * ---------------------------------------------------------------------
 * PostgREST hata gövdeleri bazen sorgunun tamamını yankılar ve sorguda
 * filtre değerleri bulunur. Dışarı çıkan hata: HTTP kodu, tablo adı ve
 * PostgREST'in `message` alanının ilk 200 karakteri. URL, başlıklar ve
 * anahtar hiçbir koşulda kütüğe yazılmaz.
 */

if (typeof window !== "undefined") {
  throw new Error("supabase-client-is-server-only");
}

const env = require("./env");

/** Tek istek üst sınırı. Alım toplu çalışır; okuma uç noktası beklemez. */
const REQUEST_TIMEOUT_MS = 8000;

/**
 * Toplu yazmada parça boyu. PostgREST tek istekte binlerce satır kabul
 * eder ama Vercel işlev gövdesi ve Supabase istek boyutu sınırlıdır;
 * 500'lük parçalar 672 oyuncu / 436 rapor ölçeğinde iki-üç isteğe denk
 * geliyor ve bir parça başarısız olduğunda kaybedilen iş küçük kalıyor.
 */
const CHUNK_SIZE = 500;
const MAX_SELECT_ROWS = 1000;

function assertConfigured() {
  if (!env.isConfigured()) {
    const hint = env.configurationHint();
    throw new Error(`supabase-not-configured${hint ? `: ${hint}` : ""}`);
  }
}

async function request(pathname, options = {}) {
  assertConfigured();

  const key = env.serviceKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${env.restUrl()}/rest/v1/${pathname}`, {
      method: options.method || "GET",
      body: options.body,
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
        detail = String((parsed && (parsed.message || parsed.hint)) || "").slice(0, 200);
      } catch (error) {
        detail = raw.slice(0, 200);
      }
      const table = String(pathname).split("?")[0];
      throw new Error(`supabase-http-${response.status} (${table})${detail ? `: ${detail}` : ""}`);
    }

    return raw ? JSON.parse(raw) : [];
  } finally {
    clearTimeout(timer);
  }
}

function chunk(rows, size = CHUNK_SIZE) {
  const out = [];
  for (let index = 0; index < rows.length; index += size) {
    out.push(rows.slice(index, index + size));
  }
  return out;
}

/**
 * ÜZERİNE YAZ (upsert).
 *
 * `resolution=merge-duplicates`, benzersiz anahtar çakıştığında satırı
 * GÜNCELLER. Alımın tekrar çalıştırılabilir olması buna bağlı: aynı gün
 * ikinci kez çalışan alım yeni satır yazmamalı, var olanı tazelemeli.
 *
 * `return=minimal` bilinçli: yazılan satırların geri dönmesi ağ trafiği
 * ve bellektir, çağıranın işine yaramaz. Kaç satır yazıldığı zaten
 * gönderilen dizinin boyudur.
 */
async function upsert(table, rows, conflictColumns) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return { written: 0, chunks: 0 };

  const query = conflictColumns
    ? `${table}?on_conflict=${encodeURIComponent(conflictColumns)}`
    : table;

  let written = 0;
  const parts = chunk(list);
  for (const part of parts) {
    await request(query, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(part)
    });
    written += part.length;
  }
  return { written, chunks: parts.length };
}

/** Ekle (çakışma beklenmiyor: kütük satırları, etkileşimler). */
async function insert(table, rows) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return { written: 0 };
  await request(table, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(list)
  });
  return { written: list.length };
}

/**
 * Oku.
 *
 * `filters` PostgREST söz dizimi taşır (`status=eq.confirmed`) ve
 * değerler ÇAĞIRAN tarafından kodlanmış varsayılmaz — burada kodlanır.
 * Sıralama ve sınır ayrı parametre: sorgu dizesini elle birleştirmek,
 * bir gün kullanıcı girdisinin filtreye karışmasıyla biter.
 */
async function select(table, { columns = "*", filters = {}, order = "", limit = MAX_SELECT_ROWS, offset = 0 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SELECT_ROWS) {
    throw new RangeError(`Supabase select limit must be an integer between 1 and ${MAX_SELECT_ROWS}`);
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError("Supabase select offset must be a non-negative safe integer");
  }
  const parts = [`select=${encodeURIComponent(columns)}`];

  for (const [column, expression] of Object.entries(filters || {})) {
    if (expression === undefined || expression === null || expression === "") continue;
    const text = String(expression);
    const separator = text.indexOf(".");
    // "eq.galatasaray" → operatör ham kalır, DEĞER kodlanır.
    if (separator > 0) {
      const operator = text.slice(0, separator);
      const value = text.slice(separator + 1);
      parts.push(`${encodeURIComponent(column)}=${operator}.${encodeURIComponent(value)}`);
    } else {
      parts.push(`${encodeURIComponent(column)}=eq.${encodeURIComponent(text)}`);
    }
  }

  if (order) parts.push(`order=${encodeURIComponent(order)}`);
  parts.push(`limit=${limit}`);
  if (offset) parts.push(`offset=${offset}`);

  const rows = await request(`${table}?${parts.join("&")}`, { method: "GET" });
  return Array.isArray(rows) ? rows : [];
}

module.exports = {
  CHUNK_SIZE,
  MAX_SELECT_ROWS,
  REQUEST_TIMEOUT_MS,
  chunk,
  insert,
  isConfigured: env.isConfigured,
  configurationHint: env.configurationHint,
  request,
  select,
  upsert
};
