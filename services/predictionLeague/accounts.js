/**
 * TAHMİN LİGİ — HESAP KURALLARI (rumuz, oturum sırrı, kurtarma kodu, kanıt-işi).
 *
 * KİŞİSEL VERİ TOPLANMAZ: e-posta, telefon, ad yok. Hesap = rumuz + gizli
 * kurtarma kodu. Çerezdeki oturum sırrı ve kurtarma kodu veritabanında yalnızca
 * SHA-256 karması olarak durur; veritabanı sızsa bile oturum çalınamaz.
 *
 * SAHTE HESAP / OTOMASYON ÖNLEMLERİ (hepsi ücretsiz, üçüncü taraf yok):
 *   • kayıtta kanıt-işi (hashcash): sunucu imzalı bir meydan okuma verir,
 *     tarayıcı ~1 sn süren bir karma araması çözer. Tek tek insan için
 *     fark edilmez, toplu hesap açan betik için pahalıdır;
 *   • honeypot alanı + en az doldurma süresi (meydan okuma zaman damgalı);
 *   • aynı IP karmasından 24 saatte en çok 3 hesap (veritabanında);
 *   • rumuz taklit koruması (`nicknameKey`) ve yasaklı sözcük/rezerve listesi.
 */
const crypto = require("crypto");

const NICKNAME_PATTERN = /^[A-Za-z0-9ÇĞİÖŞÜçğıöşü_.-]{3,16}$/;

/** Başlangıç listesi: küfür kökleri + yetkili taklidi. Listeye ekleme kolaydır. */
const BLOCKED_FRAGMENTS = [
  "admin", "moderator", "yonetici", "futbolradar", "support", "destek", "official", "resmi",
  "amk", "aq", "orospu", "piç", "pic", "sik", "yarrak", "göt", "got", "ibne", "gavat", "kahpe", "salak", "mal"
];
// Kısa kökler (aq, got, mal, pic) yalnızca TAM eşleşmede yasaklanır; aksi hâlde "Malatya" gibi
// masum rumuzlar elenirdi.
const EXACT_ONLY = new Set(["aq", "got", "mal", "pic", "sik", "amk"]);

const FOLD = { "ç": "c", "ğ": "g", "ı": "i", "i̇": "i", "ö": "o", "ş": "s", "ü": "u" };

/**
 * Taklit önleme anahtarı: küçük harf + Türkçe harfler ASCII + ayraçsız.
 * "Ali_K", "ali.k", "ALİK" aynı anahtara düşer.
 */
function nicknameKey(nickname) {
  return String(nickname || "")
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .toLowerCase()
    .replace(/i̇|[çğıöşü]/g, (char) => FOLD[char] || char)
    .replace(/[._-]/g, "");
}

/** @returns {{ok:true, nickname:string, key:string}|{ok:false, code:string, message:string}} */
function validateNickname(raw) {
  const nickname = String(raw == null ? "" : raw).normalize("NFC").trim();
  if (!NICKNAME_PATTERN.test(nickname)) {
    return { ok: false, code: "NICKNAME_FORMAT", message: "Rumuz 3-16 karakter olmalı; harf, rakam, nokta, tire ve alt çizgi kullanılabilir." };
  }
  const key = nicknameKey(nickname);
  if (!/^[a-z0-9]{3,16}$/.test(key)) {
    return { ok: false, code: "NICKNAME_FORMAT", message: "Rumuz en az 3 harf ya da rakam içermeli." };
  }
  if (/^\d+$/.test(key)) {
    return { ok: false, code: "NICKNAME_FORMAT", message: "Rumuz yalnızca rakamlardan oluşamaz." };
  }
  for (const fragment of BLOCKED_FRAGMENTS) {
    const folded = nicknameKey(fragment);
    if (EXACT_ONLY.has(fragment) ? key === folded : key.includes(folded)) {
      return { ok: false, code: "NICKNAME_BLOCKED", message: "Bu rumuz kullanılamaz. Başka bir rumuz dene." };
    }
  }
  return { ok: true, nickname, key };
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

/** Çerezde taşınan oturum sırrı (64 hex). Veritabanında yalnızca karması. */
function newSessionSecret() {
  return crypto.randomBytes(32).toString("hex");
}

function isSessionSecret(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 0/O, 1/I karışmaz

/** 16 karakterlik kurtarma kodu, 4'lü gruplar: ABCD-EFGH-JKLM-NPQR (80 bit). */
function newRecoveryCode() {
  const bytes = crypto.randomBytes(16);
  let code = "";
  for (let index = 0; index < 16; index += 1) code += RECOVERY_ALPHABET[bytes[index] % RECOVERY_ALPHABET.length];
  return code.match(/.{4}/g).join("-");
}

function normalizeRecoveryCode(value) {
  const code = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return code.length === 16 && [...code].every((char) => RECOVERY_ALPHABET.includes(char)) ? code : null;
}

function recoveryHash(code) {
  return sha256(`recovery:${code}`);
}

function sessionHash(secret) {
  return sha256(`session:${secret}`);
}

// ── Kanıt-işi ────────────────────────────────────────────────────────────

const POW_BITS = 16; // ~65 bin karma; tarayıcıda ~0.2-1 sn
const POW_MIN_AGE_MS = 2500; // insan formu bundan hızlı dolduramaz
const POW_MAX_AGE_MS = 30 * 60 * 1000;

function powSecret() {
  return (
    process.env.PREDICTION_LEAGUE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.HOME_POLL_SUPABASE_KEY ||
    "futbolradar-prediction-league-dev"
  );
}

function sign(payload) {
  return crypto.createHmac("sha256", powSecret()).update(payload).digest("hex").slice(0, 32);
}

/** Durumsuz meydan okuma: `<zaman>.<rastgele>.<imza>`. */
function createChallenge(nowMs = Date.now()) {
  const body = `${nowMs}.${crypto.randomBytes(8).toString("hex")}`;
  return { challenge: `${body}.${sign(body)}`, bits: POW_BITS, minAgeMs: POW_MIN_AGE_MS };
}

function leadingZeroBits(buffer) {
  let bits = 0;
  for (const byte of buffer) {
    if (byte === 0) { bits += 8; continue; }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

function powDigest(challenge, nonce) {
  return crypto.createHash("sha256").update(`${challenge}:${nonce}`).digest();
}

/** İstemci tarafı çözücünün Node karşılığı (testler). */
function solveChallenge(challenge, bits = POW_BITS) {
  for (let nonce = 0; nonce < 50_000_000; nonce += 1) {
    if (leadingZeroBits(powDigest(challenge, nonce)) >= bits) return String(nonce);
  }
  throw new Error("pow-unsolved");
}

/** @returns {{ok:true}|{ok:false, code:string}} */
function verifyChallenge(challenge, nonce, nowMs = Date.now()) {
  const parts = String(challenge || "").split(".");
  if (parts.length !== 3 || !/^\d{10,16}$/.test(parts[0]) || !/^[a-f0-9]{16}$/.test(parts[1])) return { ok: false, code: "POW_INVALID" };
  const expected = sign(`${parts[0]}.${parts[1]}`);
  const given = Buffer.from(parts[2]);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return { ok: false, code: "POW_INVALID" };
  const age = nowMs - Number(parts[0]);
  if (age < POW_MIN_AGE_MS) return { ok: false, code: "POW_TOO_FAST" };
  if (age > POW_MAX_AGE_MS) return { ok: false, code: "POW_EXPIRED" };
  if (!/^\d{1,9}$/.test(String(nonce))) return { ok: false, code: "POW_INVALID" };
  if (leadingZeroBits(powDigest(challenge, String(nonce))) < POW_BITS) return { ok: false, code: "POW_INVALID" };
  return { ok: true };
}

/** Tuzlu IP karması (kayıt sınırı için). Tuz yoksa null: IP hiç işlenmez. */
function ipHash(ip) {
  const salt = process.env.HOME_POLL_IP_SALT || process.env.SUPABASE_IP_SALT || "";
  const clean = String(ip || "").trim();
  if (!salt || !clean) return null;
  return crypto.createHash("sha256").update(`league:${salt}:${clean}`).digest("hex").slice(0, 32);
}

module.exports = {
  NICKNAME_PATTERN,
  POW_BITS,
  POW_MIN_AGE_MS,
  createChallenge,
  ipHash,
  isSessionSecret,
  newRecoveryCode,
  newSessionSecret,
  nicknameKey,
  normalizeRecoveryCode,
  recoveryHash,
  sessionHash,
  solveChallenge,
  validateNickname,
  verifyChallenge
};
