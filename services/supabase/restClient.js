/**
 * SUPABASE İSTEMCİSİ — bağımlılıksız PostgREST sarmalayıcısı.
 *
 * NEDEN @supabase/supabase-js DEĞİL?
 *
 * Bu depo BİLEREK bağımlılıksız: package.json'da tek bir dependency yok ve
 * vercel.json `"installCommand": ""` diyor — yani dağıtımda `npm install`
 * HİÇ ÇALIŞMIYOR. Resmî istemciyi bağımlılık olarak eklemek, üretimde var
 * olmayan bir modülü require etmek demek olurdu: yerelde çalışır, canlıda
 * ilk istekte patlardı.
 *
 * Supabase'in veri katmanı zaten sıradan bir HTTP arayüzü (PostgREST).
 * `fetch` ile konuşmak hem bağımlılıksız hem de deponun mevcut sağlayıcı
 * deseniyle (services/providers/*) aynı biçimde.
 *
 * KAPSAM SINIRI: bu sarmalayıcı kasıtlı olarak DAR. Sorgu kurucu, gerçek
 * zamanlı abonelik, depolama ve auth YOK — çünkü hiçbiri kullanılmıyor.
 * Kullanılmayan yüzey, bakımı yapılmayan yüzeydir.
 *
 * ANAHTAR GÜNLÜĞE YAZILMAZ. Hata mesajları durum kodunu ve sağlayıcının
 * gövdesini taşır; başlıklar hiçbir koşulda mesaja girmez.
 */

const { DEFAULT_TIMEOUT_MS, REST_PATH } = require("./config.js");

/** PostgREST'in döndürdüğü hata bir HTTP hatası değil, veri hatasıdır. */
class SupabaseError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SupabaseError";
    this.status = details.status || 0;
    this.code = details.code || "SUPABASE_ERROR";
    this.hint = details.hint || null;
    this.table = details.table || null;
  }
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new SupabaseError(`Supabase isteği zaman aşımına uğradı: ${label}`, {
        code: "SUPABASE_TIMEOUT"
      }));
    }, ms);

    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

/**
 * PostgREST sorgu dizesi.
 *
 * Değerler encodeURIComponent'ten geçer; `eq.`, `in.` gibi işleç önekleri
 * çağıran tarafından verilir. Ham dize birleştirme YOK — enjeksiyon yüzeyi
 * burada kapanıyor.
 */
function buildQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    search.append(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

/**
 * Bir Supabase istemcisi.
 *
 * @param {{url: string, key: string, role: "anon"|"service", timeoutMs?: number,
 *   fetchImpl?: Function}} options
 */
function createClient(options = {}) {
  const url = String(options.url || "").replace(/\/+$/, "");
  const key = String(options.key || "");
  const role = options.role === "service" ? "service" : "anon";
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const fetchImpl = typeof options.fetchImpl === "function"
    ? options.fetchImpl
    : (typeof fetch === "function" ? fetch : null);

  /** Yapılandırma eksikse istemci sessizce çalışmaz — açıkça söyler. */
  const ready = Boolean(url && key && fetchImpl);

  function requireReady(operation) {
    if (!url) throw new SupabaseError(`Supabase adresi tanımlı değil (${operation}).`, { code: "SUPABASE_NO_URL" });
    if (!key) throw new SupabaseError(`Supabase anahtarı tanımlı değil (${operation}).`, { code: "SUPABASE_NO_KEY" });
    if (!fetchImpl) throw new SupabaseError("Bu çalışma ortamında fetch yok.", { code: "SUPABASE_NO_FETCH" });
  }

  async function request(method, pathname, { query, body, headers, table } = {}) {
    requireReady(`${method} ${pathname}`);

    const target = `${url}${REST_PATH}${pathname}${buildQuery(query)}`;
    const requestHeaders = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...headers
    };

    const response = await withTimeout(
      fetchImpl(target, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body)
      }),
      timeoutMs,
      `${method} ${pathname}`
    );

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      // Sağlayıcının mesajı taşınır; BAŞLIKLAR TAŞINMAZ — anahtar oradaydı.
      const message = (payload && (payload.message || payload.error_description || payload.error))
        || `Supabase isteği başarısız (${response.status})`;
      throw new SupabaseError(message, {
        status: response.status,
        code: (payload && payload.code) || `SUPABASE_HTTP_${response.status}`,
        hint: (payload && payload.hint) || null,
        table: table || null
      });
    }

    return payload;
  }

  /**
   * Tablo erişimi. Yalnızca gerçekten kullanılan dört işlem var.
   */
  function from(table) {
    const pathname = `/${encodeURIComponent(table)}`;

    return {
      /**
       * @param {{columns?: string, filters?: object, order?: string,
       *   limit?: number, offset?: number}} [params]
       */
      async select(params = {}) {
        const query = {
          select: params.columns || "*",
          ...(params.filters || {})
        };
        if (params.order) query.order = params.order;
        if (Number.isFinite(params.limit)) query.limit = params.limit;
        if (Number.isFinite(params.offset)) query.offset = params.offset;

        const rows = await request("GET", pathname, { query, table });
        return Array.isArray(rows) ? rows : [];
      },

      /** Kayıt sayısı. Gövde çekilmez; sayım başlıktan okunur. */
      async count(filters = {}) {
        requireReady(`COUNT ${table}`);
        const target = `${url}${REST_PATH}${pathname}${buildQuery({ select: "*", ...filters })}`;
        const response = await withTimeout(
          fetchImpl(target, {
            method: "HEAD",
            headers: {
              apikey: key,
              Authorization: `Bearer ${key}`,
              Prefer: "count=exact",
              // HEAD isteği zaten gövde döndürmez; `Range: 0-0` yalnızca
              // sayfalama penceresini tek satıra daraltır ki PostgREST tam
              // sayımı hesaplarken gereksiz iş yapmasın. Sayının kendisi
              // aşağıda `content-range` başlığından okunuyor.
              Range: "0-0"
            }
          }),
          timeoutMs,
          `COUNT ${table}`
        );

        if (!response.ok && response.status !== 206) {
          throw new SupabaseError(`Sayım başarısız (${response.status})`, {
            status: response.status, code: `SUPABASE_HTTP_${response.status}`, table
          });
        }

        const range = response.headers && response.headers.get
          ? response.headers.get("content-range")
          : null;
        const total = range && range.includes("/") ? Number(range.split("/").pop()) : null;
        return Number.isFinite(total) ? total : null;
      },

      async insert(rows, params = {}) {
        return request("POST", pathname, {
          body: Array.isArray(rows) ? rows : [rows],
          headers: { Prefer: params.returning === false ? "return=minimal" : "return=representation" },
          table
        });
      },

      /**
       * Çakışmada güncelle. `onConflict` benzersiz kısıtın sütun adıdır;
       * verilmezse PostgREST birincil anahtarı kullanır.
       */
      async upsert(rows, params = {}) {
        const query = params.onConflict ? { on_conflict: params.onConflict } : undefined;
        return request("POST", pathname, {
          query,
          body: Array.isArray(rows) ? rows : [rows],
          headers: {
            Prefer: `resolution=merge-duplicates,${params.returning === false ? "return=minimal" : "return=representation"}`
          },
          table
        });
      },

      /** Filtresiz güncelleme YAPILMAZ: tüm tabloyu ezmek kaza olamaz. */
      async update(values, filters) {
        if (!filters || !Object.keys(filters).length) {
          throw new SupabaseError(
            `Filtresiz güncelleme reddedildi (${table}). Tüm tabloyu değiştirmek kaza olmamalı.`,
            { code: "SUPABASE_UNFILTERED_UPDATE", table }
          );
        }
        return request("PATCH", pathname, {
          query: filters,
          body: values,
          headers: { Prefer: "return=representation" },
          table
        });
      },

      /** Filtresiz silme de aynı sebeple reddedilir. */
      async remove(filters) {
        if (!filters || !Object.keys(filters).length) {
          throw new SupabaseError(
            `Filtresiz silme reddedildi (${table}).`,
            { code: "SUPABASE_UNFILTERED_DELETE", table }
          );
        }
        return request("DELETE", pathname, {
          query: filters,
          headers: { Prefer: "return=representation" },
          table
        });
      }
    };
  }

  /** Saklı yordam çağrısı (pgvector benzerlik araması bunu kullanır). */
  async function rpc(name, args = {}) {
    return request("POST", `/rpc/${encodeURIComponent(name)}`, { body: args, table: name });
  }

  return { ready, role, from, rpc, request };
}

module.exports = { SupabaseError, buildQuery, createClient };
