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

/** Ortam değişkeni adları. Supabase kendi adlarını verir; proje-özel ad da kabul edilir. */
const REST_URL_ENV_NAMES = ["SUPABASE_URL", "HOME_POLL_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"];
const SERVICE_KEY_ENV_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
  "HOME_POLL_SUPABASE_KEY"
];
/** IP karması için gizli tuz. Yoksa IP katmanı çalışmaz (gerekçe yukarıda). */
const IP_SALT_ENV_NAMES = ["HOME_POLL_IP_SALT", "SUPABASE_IP_SALT"];

const TABLE = "home_poll_votes";

/** Tek istek için üst sınır; ağ takılırsa uç nokta asılı kalmasın. */
const REQUEST_TIMEOUT_MS = 4000;

function firstEnv(names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function restUrl() {
  return firstEnv(REST_URL_ENV_NAMES).replace(/\/+$/, "");
}

function serviceKey() {
  return firstEnv(SERVICE_KEY_ENV_NAMES);
}

function ipSalt() {
  return firstEnv(IP_SALT_ENV_NAMES);
}

/** Depo yapılandırılmış mı? Değilse özellik kapalıdır. */
function isConfigured() {
  return Boolean(restUrl() && serviceKey());
}

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
    if (!response.ok) throw new Error(`home-poll-store-http-${response.status}`);

    const raw = await response.text();
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

module.exports = {
  IP_SALT_ENV_NAMES,
  REST_URL_ENV_NAMES,
  SERVICE_KEY_ENV_NAMES,
  TABLE,
  findVote,
  isConfigured,
  readTally,
  recordVote,
  voterKeyFor
};
