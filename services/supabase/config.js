/**
 * SUPABASE YAPILANDIRMASI — kimlik bilgileri tek noktadan okunur.
 *
 * ANAHTAR ASLA KODA YAZILMAZ. Değerler yalnızca ortam değişkenlerinden gelir
 * ve bu dosyanın hiçbir fonksiyonu anahtarın KENDİSİNİ döndürmez; yalnızca
 * "doğru değişkene doğru biçimde girilmiş mi" sorusunu cevaplar. Aynı desen
 * api/health.js içinde API-Football anahtarı için zaten uygulanıyor.
 *
 * İKİ ANAHTAR, İKİ DÜNYA — bu dosyanın en önemli ayrımı:
 *
 *   ANON       Tarayıcıya verilebilir. Satır düzeyi güvenlik (RLS) politikaları
 *              onu yalnızca okumaya izinli tutar. Sızması bir felaket değildir;
 *              zaten herkese açık veriyi okur.
 *   SERVICE    RLS'i TAMAMEN BAYPAS EDER. Bu anahtar veritabanının tamamına
 *              sınırsız yazma yetkisi verir. Tarayıcıya ulaşması, veritabanını
 *              internete açmakla aynı şeydir.
 *
 * Bu yüzden servis anahtarı yalnızca `serverClient.js` üzerinden okunur ve
 * scripts/test-supabase-layer.mjs yayımlanan hiçbir dosyada (app.js, HTML,
 * public/) ne adının ne de değerinin geçmediğini doğrular.
 */

/**
 * Kabul edilen değişken adları. İlk dolu olan kullanılır.
 *
 * Birden fazla ad kabul ediliyor çünkü Supabase panosu, Vercel entegrasyonu ve
 * yerel .env dosyaları farklı adlar öneriyor; hangisinin kullanıldığını
 * tahmin etmek yerine hepsi tanınıyor. Hangisinin okunduğu sağlık ucunda
 * raporlanır, böylece "anahtar tanımlı ama yanlış isimde" durumu görünür olur.
 */
const URL_ENV_NAMES = Object.freeze([
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "PUBLIC_SUPABASE_URL",
  "VITE_SUPABASE_URL"
]);

/** Tarayıcıya verilebilir anahtar. */
const ANON_KEY_ENV_NAMES = Object.freeze([
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_ANON_KEY"
]);

/**
 * SUNUCUYA ÖZEL ANAHTAR. Bu listedeki hiçbir ad, tarayıcıya giden hiçbir
 * dosyada geçmemelidir — test bunu denetler.
 *
 * "NEXT_PUBLIC_" ya da "PUBLIC_" ön ekli bir servis anahtarı adı BİLEREK
 * kabul edilmiyor: o ön ekler değeri istemci paketine gömmek için vardır ve
 * böyle adlandırılmış bir servis anahtarı zaten yanlış yapılandırılmıştır.
 */
const SERVICE_KEY_ENV_NAMES = Object.freeze([
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_SECRET_KEY"
]);

/** İstek zaman aşımı. Sağlayıcı yanıt vermezse sayfa beklemez. */
const DEFAULT_TIMEOUT_MS = 6000;

/** PostgREST yolu. Supabase bunu sabit tutuyor. */
const REST_PATH = "/rest/v1";

function readFirst(names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return { name, value };
  }
  return { name: null, value: "" };
}

/** Proje adresi. Sonda eğik çizgi varsa kırpılır. */
function readUrl() {
  const found = readFirst(URL_ENV_NAMES);
  return found.value ? found.value.replace(/\/+$/, "") : "";
}

function readAnonKey() {
  return readFirst(ANON_KEY_ENV_NAMES).value;
}

/**
 * SERVİS ANAHTARI — yalnızca sunucu tarafında çağrılmalı.
 *
 * Bu fonksiyon tarayıcıda çalıştırılırsa ortada bir yapılandırma hatası var
 * demektir; sessizce boş dönmek o hatayı gizlerdi. Bu yüzden AÇIKÇA patlar.
 */
function readServiceKey() {
  if (typeof window !== "undefined") {
    throw new Error(
      "Supabase servis anahtarı tarayıcıda okunamaz. Bu anahtar RLS'i baypas eder; " +
      "istemci tarafında kullanılması veritabanını herkese açmak demektir."
    );
  }
  return readFirst(SERVICE_KEY_ENV_NAMES).value;
}

/** Supabase JWT'leri üç parçalı ve "ey" ile başlar (base64 '{"'). */
function looksLikeSupabaseKey(value) {
  const key = String(value || "").trim();
  if (!key) return false;
  // Yeni "sb_publishable_/sb_secret_" biçimi de kabul edilir.
  if (/^sb_(publishable|secret)_[A-Za-z0-9_-]{10,}$/.test(key)) return true;
  return /^ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/.test(key);
}

function looksLikeSupabaseUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Yapılandırma eksiksiz mi? Anahtar değeri döndürülmez. */
function hasAnonConfig() {
  return Boolean(readUrl() && readAnonKey());
}

function hasServiceConfig() {
  if (typeof window !== "undefined") return false;
  return Boolean(readUrl() && readServiceKey());
}

/**
 * Kimlik bilgisinin BİÇİMİ — değeri değil.
 *
 * "Anahtar tanımlı" ile "anahtar doğru" farklı sorular. Sonda boşluk taşıyan
 * ya da tırnak içinde yapıştırılmış bir anahtar sağlayıcıda "geçersiz" olarak
 * görünür ve sebebi anlaşılmaz. Bu alanlar o farkı görünür kılar; değerin
 * kendisi hiçbir koşulda yanıta girmez.
 */
function credentialShape(names) {
  return names
    .filter((name) => process.env[name] !== undefined && process.env[name] !== "")
    .map((name) => {
      const raw = String(process.env[name]);
      const trimmed = raw.trim();
      return {
        env: name,
        length: trimmed.length,
        looksValidFormat: looksLikeSupabaseKey(trimmed),
        hadSurroundingWhitespace: raw !== trimmed,
        looksQuoted: /^["'].*["']$/.test(trimmed)
      };
    });
}

/**
 * Sağlık ucunun okuduğu özet. ANAHTAR DEĞERİ İÇERMEZ.
 *
 * @returns {object} yalnızca varlık, ad ve biçim bilgisi
 */
function describeConfig() {
  const url = readUrl();
  const anonFound = readFirst(ANON_KEY_ENV_NAMES);
  // Servis anahtarının VARLIĞI sunucuda raporlanabilir; değeri asla.
  const serviceFound = typeof window === "undefined"
    ? readFirst(SERVICE_KEY_ENV_NAMES)
    : { name: null, value: "" };

  return {
    configured: Boolean(url && anonFound.value),
    url: {
      configured: Boolean(url),
      envName: readFirst(URL_ENV_NAMES).name,
      looksValidFormat: looksLikeSupabaseUrl(url),
      // Adres gizli değil (tarayıcıya zaten gidiyor) ama yine de yalnızca
      // sunucu adı raporlanıyor; tam adres gerekmiyor.
      host: url ? (() => { try { return new URL(url).hostname; } catch { return null; } })() : null
    },
    anonKey: {
      configured: Boolean(anonFound.value),
      envName: anonFound.name,
      shape: credentialShape(ANON_KEY_ENV_NAMES)
    },
    serviceKey: {
      configured: Boolean(serviceFound.value),
      envName: serviceFound.name,
      shape: credentialShape(SERVICE_KEY_ENV_NAMES),
      // Bu satır bir uyarıdır: servis anahtarı "public" ön ekli bir adla
      // tanımlanmışsa yapılandırma baştan yanlıştır.
      publiclyNamed: Object.keys(process.env).some((name) =>
        /^(NEXT_PUBLIC_|PUBLIC_|VITE_)/.test(name) && /SERVICE_ROLE|SERVICE_KEY|SECRET/i.test(name))
    },
    restPath: REST_PATH,
    timeoutMs: DEFAULT_TIMEOUT_MS
  };
}

module.exports = {
  ANON_KEY_ENV_NAMES,
  DEFAULT_TIMEOUT_MS,
  REST_PATH,
  SERVICE_KEY_ENV_NAMES,
  URL_ENV_NAMES,
  credentialShape,
  describeConfig,
  hasAnonConfig,
  hasServiceConfig,
  looksLikeSupabaseKey,
  looksLikeSupabaseUrl,
  readAnonKey,
  readServiceKey,
  readUrl
};
