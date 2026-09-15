/**
 * ANA SAYFA ANKETİ OY DEPOSU — SUPABASE.
 *
 * BAĞIMLILIK EKLENMİYOR. Supabase'in PostgREST arayüzüne düz `fetch` ile
 * konuşuluyor; `@supabase/supabase-js` paketine gerek yok. Depoda bugüne
 * kadar hiç çalışma-zamanı bağımlılığı olmadı (maçın adamı deposu da Redis
 * REST'e düz fetch ile konuşuyor) ve bu özellik de eklemiyor.
 *
 * DEPO YOKSA ÖZELLİK KAPALIDIR, UYDURMA DEĞİL. Ortam değişkeni
 * tanımlanmamışsa `isConfigured()` false döner, uç nokta "kapalı" der ve
 * istemci ankete oy VERDİRMEZ, yalnızca soruyu ve seçenekleri gösterir.
 * Sıfır oyu "%0" diye göstermek de bir iddiadır ve o iddia ancak gerçek
 * bir sayım varsa yapılabilir.
 *
 * TEK OY: ÜÇ KATMAN, AMA YALNIZCA BİRİ SAYAR.
 *
 *   1. `localStorage` — NEZAKET. Kullanıcıya "zaten oy verdin" demenin en
 *      hızlı yolu; temizlenebilir, gizli sekmede yoktur, SAYMAZ.
 *   2. `HttpOnly` çerez — aynı tarayıcıyı tanır. Kişiye bağlanmaz: rastgele
 *      32 karakter, "kim oy verdi" sorusunu değil "bu tarayıcı daha önce oy
 *      verdi mi" sorusunu yanıtlar.
 *   3. IP KARMASI — çerezini silen aynı kişiyi tanır. IP'nin KENDİSİ
 *      SAKLANMAZ: gizli bir tuzla (`HOME_POLL_IP_SALT`) SHA-256 karması
 *      alınır ve yalnızca karma yazılır. Ham IP kişisel veridir; tahmin
 *      anketi için onu saklamak, sorunun değerine göre fazlasıyla ağır bir
 *      bedeldir. Tuz olmadan karma da kurulmaz — tuzsuz karma, dar IP
 *      uzayında kaba kuvvetle geri çözülebilir olurdu.
 *
 * Sayan katman VERİTABANIDIR: `(poll_id, voter_key)` üzerinde BENZERSİZ
 * kısıt vardır ve ikinci oy `409` ile geri döner. "Önce sorayım, sonra
 * yazayım" yarış durumu açardı; kısıt atomiktir.
 *
 * ŞEMA (bir kez çalıştırılır — docs/home-poll.md içinde de yazılı):
 *
 *   create table home_poll_votes (
 *     id bigserial primary key,
 *     poll_id text not null,
 *     option_id text not null,
 *     voter_key text not null,
 *     created_at timestamptz not null default now(),
 *     unique (poll_id, voter_key)
 *   );
 *   create index on home_poll_votes (poll_id, option_id);
 *   alter table home_poll_votes enable row level security;
 *
 * RLS açık ve hiçbir politika tanımlı DEĞİL: tabloya yalnızca servis
 * anahtarıyla, yani bu sunucu üzerinden yazılır. Anon anahtarla tarayıcıdan
 * doğrudan yazılabilseydi doğrulama (seçenek gerçekten ankette mi, pencere
 * açık mı) atlanabilirdi.
 */

const crypto = require("crypto");

/**
 * KİMLİK BİLGİSİ MANTIĞI ARTIK BURADA DEĞİL.
 *
 * Değişken adları, anahtar rolü okuma ve teşhis metni önce bu dosyanın
 * içindeydi. Veri katmanı (`services/supabase/`) ikinci tüketici olunca
 * kopyalanacaklardı; kopyalanmış kimlik mantığının bilinen sonu, bir gün
 * yeni bir değişken adının yalnızca bir kopyaya eklenmesi ve iki yüzeyin
 * aynı ortamda farklı cevap vermesidir. Tek okuma noktası
 * `services/supabase/env.js`; dışa aktarımlar aynen korunuyor, çünkü
 * `api/health.js` ve `scripts/check-home-poll-store.mjs` bu adları
 * buradan okuyor.
 */
const supabaseEnv = require("./supabase/env");

const {
  ANON_KEY_ENV_NAMES,
  IP_SALT_ENV_NAMES,
  REST_URL_ENV_NAMES,
  SERVICE_KEY_ENV_NAMES,
  configurationHint,
  ipSalt,
  isConfigured,
  keyRole,
  restUrl,
  serviceKey
} = supabaseEnv;

const TABLE = "home_poll_votes";

/**
 * PAYLAŞIM SAYACI — AYRI TABLO, KİŞİSEL VERİ YOK.
 *
 * "Hangi ağda paylaşıldı" sorusu oy tablosunda yanıtlanamaz: paylaşım oy
 * değildir, bir oyun üstüne yazılırsa sayım bozulur. Bu yüzden ayrı bir
 * tablo — ve o tabloda SEÇMEN ANAHTARI YOKTUR: "kim paylaştı" sorusunu
 * yanıtlamaya ihtiyacımız yok, "bu anket X'te kaç kez paylaşıldı" sorusu
 * yetiyor. Toplamayacağımız veriyi toplamamak, sonradan korumak zorunda
 * kalmamanın en ucuz yolu.
 *
 *   create table home_poll_shares (
 *     id bigserial primary key,
 *     poll_id text not null,
 *     platform text not null,
 *     locale text not null default 'tr',
 *     created_at timestamptz not null default now()
 *   );
 */
const SHARE_TABLE = "home_poll_shares";

/** Kabul edilen paylaşım kanalları. Liste dışı bir değer YAZILMAZ. */
const SHARE_PLATFORMS = Object.freeze(["x", "whatsapp", "facebook", "telegram", "native", "copy", "instagram", "download"]);

/** Tek istek için üst sınır; ağ takılırsa uç nokta asılı kalmasın. */
const REQUEST_TIMEOUT_MS = 4000;

/**
 * SEÇMEN ANAHTARI.
 *
 * Çerez kimliği ve (varsa) IP karması BİRLİKTE değil, SIRAYLA kullanılır:
 * anahtar tek bir dizedir, çünkü benzersiz kısıt tek sütun üzerindedir.
 * IP karması varsa o tercih edilir — çerez silinerek aşılabilir, IP daha
 * zor değişir. Tuz tanımlı değilse çerez kimliğine düşülür; bu, korumanın
 * zayıflaması demektir ama ham IP saklamaktan iyidir.
 */
function voterKeyFor(voterId, ip) {
  const salt = ipSalt();
  const cleanIp = String(ip || "").trim();
  if (salt && cleanIp) {
    return `ip:${crypto.createHash("sha256").update(`${salt}:${cleanIp}`).digest("hex").slice(0, 32)}`;
  }
  return `br:${String(voterId || "").trim()}`;
}

async function supabaseRequest(pathname, options = {}) {
  const base = restUrl();
  const key = serviceKey();
  if (!base || !key) throw new Error("home-poll-store-not-configured");

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

    // 409 = benzersiz kısıt: bu seçmen bu ankette zaten oy kullanmış.
    // Bir HATA değil, bir DURUM; çağıran onu "sonucu göster" diye işler.
    if (response.status === 409) return { conflict: true, rows: null };

    const raw = await response.text();

    if (!response.ok) {
      // PostgREST hata gövdesi ŞEMA bilgisi taşır (ör. "relation ... does
      // not exist", "JWT expired"), SIR taşımaz. Yalnızca `message`/`hint`
      // alanı ve en fazla 200 karakter alınır — anahtarın kendisi hiçbir
      // koşulda bu gövdede yoktur zaten (PostgREST anahtarı yankılamaz).
      let detail = "";
      try {
        const parsed = JSON.parse(raw);
        detail = String((parsed && (parsed.message || parsed.hint || parsed.code)) || "").slice(0, 200);
      } catch (error) {
        detail = raw.slice(0, 200);
      }
      throw new Error(`home-poll-store-http-${response.status}${detail ? `: ${detail}` : ""}`);
    }

    return { conflict: false, rows: raw ? JSON.parse(raw) : [] };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sayımı oku.
 *
 * PostgREST toplama yapabiliyor ama sürüm farklarına dayanmamak için satırlar
 * çekilip burada sayılıyor; anket başına satır sayısı ana sayfa ölçeğinde
 * sınırlı ve `select` yalnızca `option_id` taşıyor (kişisel alan çekilmiyor).
 *
 * Dönen nesne YALNIZCA sayıları taşır; hangi seçeneğin geçerli olduğu
 * çağıranın işi — depoda kalmış eski bir seçeneği süzmek uç noktaya aittir.
 */
async function readTally(pollId) {
  const query = `${TABLE}?poll_id=eq.${encodeURIComponent(pollId)}&select=option_id`;
  const { rows } = await supabaseRequest(query, { method: "GET" });

  const counts = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const optionId = String((row && row.option_id) || "").trim();
    if (!optionId) continue;
    counts[optionId] = (counts[optionId] || 0) + 1;
  }
  return counts;
}

/**
 * Oyu kaydet.
 *
 * Dönüş `{ counted }`: `false`, bu seçmenin bu ankette zaten oyu olduğunu
 * söyler (benzersiz kısıt). Çağıran bunu bir hata olarak değil, "sonucu
 * göster" durumu olarak işler.
 */
async function recordVote(pollId, optionId, voterKey) {
  const { conflict } = await supabaseRequest(TABLE, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ poll_id: pollId, option_id: optionId, voter_key: voterKey })
  });
  return { counted: !conflict };
}

/** Bu seçmen bu ankette oy kullanmış mı? Kullandıysa hangi seçeneğe? */
async function findVote(pollId, voterKey) {
  const query = `${TABLE}?poll_id=eq.${encodeURIComponent(pollId)}` +
    `&voter_key=eq.${encodeURIComponent(voterKey)}&select=option_id&limit=1`;
  const { rows } = await supabaseRequest(query, { method: "GET" });
  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? { voted: true, optionId: String(row.option_id || "") } : { voted: false, optionId: "" };
}

/**
 * PAYLAŞIMI KAYDET — SESSİZCE BAŞARISIZ OLUR.
 *
 * Paylaşım sayacı bir ANALİTİK; okuyucunun paylaşımını engelleyemez.
 * Tablo yoksa ya da yazma düşerse `false` döner ve uç nokta yine "tamam"
 * der: paylaşım penceresi açılmışsa iş zaten olmuştur, sayamamış olmamız
 * kullanıcıya bir hata olarak gösterilemez.
 */
async function recordShare(pollId, platform, locale) {
  const clean = String(platform || "").trim().toLowerCase();
  if (!SHARE_PLATFORMS.includes(clean)) return { recorded: false, reason: "unknown-platform" };
  if (!isConfigured()) return { recorded: false, reason: "not-configured" };

  try {
    await supabaseRequest(SHARE_TABLE, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        poll_id: String(pollId || ""),
        platform: clean,
        locale: locale === "en" ? "en" : "tr"
      })
    });
    return { recorded: true, reason: "" };
  } catch (error) {
    return { recorded: false, reason: "store-unavailable" };
  }
}

/**
 * PAYLAŞIM SAYISINI OKU — YALNIZCA TEŞHİS İÇİN.
 *
 * `recordShare` sessizce başarısız oluyor (paylaşımı engelleyemez), yani
 * tablo hiç oluşturulmamışsa sayaç sonsuza kadar hiçbir şey yazmaz ve kimse
 * fark etmez. `scripts/check-home-poll-store.mjs` bu okumayla o sessizliği
 * kırıyor. Ekranda hiçbir yerde kullanılmaz.
 */
async function countShares(pollId) {
  const query = `${SHARE_TABLE}?poll_id=eq.${encodeURIComponent(pollId)}&select=platform`;
  const { rows } = await supabaseRequest(query, { method: "GET" });
  return Array.isArray(rows) ? rows.length : 0;
}

module.exports = {
  ANON_KEY_ENV_NAMES,
  IP_SALT_ENV_NAMES,
  REST_URL_ENV_NAMES,
  SERVICE_KEY_ENV_NAMES,
  SHARE_PLATFORMS,
  SHARE_TABLE,
  TABLE,
  configurationHint,
  countShares,
  findVote,
  isConfigured,
  keyRole,
  readTally,
  recordShare,
  recordVote,
  voterKeyFor
};
