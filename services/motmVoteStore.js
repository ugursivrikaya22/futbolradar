/**
 * MAÇIN ADAMI OY DEPOSU.
 *
 * Anket şimdiye kadar oyları yalnızca tarayıcıda tutuyordu ve gösterilen
 * yüzde "bu cihazdaki oylar"dı — dürüsttü ama topluluk sonucu değildi.
 * Bu modül gerçek toplamı mümkün kılan yazma yolunu açar.
 *
 * BAĞIMLILIK EKLENMİYOR. Depo, Redis'in REST arayüzüne düz `fetch` ile
 * konuşuyor. Vercel KV de Upstash de aynı REST sözleşmesini sunduğu için
 * `@vercel/kv` paketine gerek yok; depoda bugüne kadar hiç çalışma-zamanı
 * bağımlılığı yok ve bu özellik için de olmayacak.
 *
 * DEPO YOKSA ÖZELLİK KAPALIDIR, UYDURMA DEĞİL. Ortam değişkeni
 * tanımlanmamışsa `isConfigured()` false döner ve uç nokta "kapalı" der.
 * İstemci o yanıtı görünce cihaz-yerel kipe döner. Hiçbir koşulda
 * uydurulmuş bir sayı üretilmez — sıfır oyu "%0" diye göstermek de bir
 * iddiadır ve o iddia ancak gerçek bir sayım varsa yapılabilir.
 *
 * AYNI CİHAZ İKİ KEZ SAYILMAZ. Tekrarı istemcideki `localStorage`
 * engelliyordu; o yalnızca bir NEZAKET katmanıdır (temizlenebilir, gizli
 * sekmede yoktur). Sayım sunucuda tutulduğu için tekrar kontrolü de
 * sunucuda: her oy anonim bir seçmen kimliğiyle bir kümeye yazılır, küme
 * zaten içeriyorsa oy sayılmaz. Kimlik bir çerezde taşınır ve KİŞİYE
 * BAĞLANMAZ — rastgele bir dizi; kim olduğunu değil, "bu tarayıcı daha
 * önce oy verdi mi" sorusunu yanıtlar.
 */

/**
 * Ortam değişkeni adları. Vercel KV kendi adlarını, Upstash kendi adlarını
 * veriyor; ikisi de aynı REST sözleşmesini konuşuyor.
 */
const REST_URL_ENV_NAMES = ["KV_REST_API_URL", "UPSTASH_REDIS_REST_URL", "MOTM_REDIS_REST_URL"];
const REST_TOKEN_ENV_NAMES = ["KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN", "MOTM_REDIS_REST_TOKEN"];

/** Oyların raf ömrü: bir sezon. Süresiz büyüyen bir depo bir sızıntıdır. */
const VOTE_TTL_SECONDS = 400 * 24 * 60 * 60;

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

function restToken() {
  return firstEnv(REST_TOKEN_ENV_NAMES);
}

/** Depo yapılandırılmış mı? Değilse özellik kapalıdır. */
function isConfigured() {
  return Boolean(restUrl() && restToken());
}

function tallyKey(matchId) {
  return `futbolradar:motm:tally:${matchId}`;
}

function voterKey(matchId) {
  return `futbolradar:motm:voters:${matchId}`;
}

/**
 * Redis REST çağrısı. Komut, yol parçaları olarak gönderilir
 * (`/HINCRBY/key/field/1`) — bu arayüzün standart biçimi.
 *
 * Parçalar `encodeURIComponent`ten geçer: maç kimliği ve seçenek kimliği
 * dışarıdan geliyor ve kaçırılmadan yola konursa komut sınırını aşabilir.
 */
async function redisCommand(parts) {
  const base = restUrl();
  const token = restToken();
  if (!base || !token) throw new Error("motm-vote-store-not-configured");

  const path = parts.map((part) => encodeURIComponent(String(part))).join("/");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${base}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`motm-vote-store-http-${response.status}`);
    const payload = await response.json();
    return payload && Object.prototype.hasOwnProperty.call(payload, "result") ? payload.result : null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sayımı oku.
 *
 * Dönen nesne YALNIZCA sayıları taşır; hangi seçeneğin geçerli olduğu
 * çağıranın işi. Depoda eski bir seçenek kalmışsa (kadro düzeltilmiş
 * olabilir) onu süzmek uç noktaya ait — depo veriyi yorumlamaz.
 */
async function readTally(matchId) {
  const raw = await redisCommand(["HGETALL", tallyKey(matchId)]);
  const counts = {};

  // REST arayüzü HGETALL'ı düz dizi ([alan, değer, ...]) ya da nesne olarak
  // döndürebiliyor; iki biçim de destekleniyor.
  if (Array.isArray(raw)) {
    for (let index = 0; index + 1 < raw.length; index += 2) {
      const count = Number(raw[index + 1]);
      if (Number.isFinite(count) && count > 0) counts[String(raw[index])] = count;
    }
  } else if (raw && typeof raw === "object") {
    for (const [field, value] of Object.entries(raw)) {
      const count = Number(value);
      if (Number.isFinite(count) && count > 0) counts[field] = count;
    }
  }

  return counts;
}

/**
 * Oyu kaydet.
 *
 * Dönüş `{ counted }`: `false`, bu seçmenin bu maçta zaten oyu olduğunu
 * söyler. Çağıran bunu bir HATA olarak değil, "sonucu göster" durumu
 * olarak işler — kullanıcı iki kez oy vermeye çalışmış olabilir, bu bir
 * arıza değil.
 */
async function recordVote(matchId, optionId, voterId) {
  // SADD yeni eklediyse 1, zaten varsa 0 döner. Tekrar kontrolü tek atomik
  // adımda olur; önce "var mı" diye sorup sonra yazmak yarış durumu açardı.
  const added = await redisCommand(["SADD", voterKey(matchId), voterId]);
  if (Number(added) !== 1) return { counted: false };

  await redisCommand(["HINCRBY", tallyKey(matchId), optionId, 1]);

  // Raf ömrü her yazmada tazelenir: hâlâ oylanan bir maç düşmesin,
  // unutulmuş bir maç sonsuza kadar yer kaplamasın.
  await Promise.all([
    redisCommand(["EXPIRE", tallyKey(matchId), VOTE_TTL_SECONDS]),
    redisCommand(["EXPIRE", voterKey(matchId), VOTE_TTL_SECONDS])
  ]);

  return { counted: true };
}

/** Bu seçmen bu maçta oy kullanmış mı? */
async function hasVoted(matchId, voterId) {
  const member = await redisCommand(["SISMEMBER", voterKey(matchId), voterId]);
  return Number(member) === 1;
}

module.exports = {
  REST_TOKEN_ENV_NAMES,
  REST_URL_ENV_NAMES,
  VOTE_TTL_SECONDS,
  hasVoted,
  isConfigured,
  readTally,
  recordVote,
  tallyKey,
  voterKey
};
