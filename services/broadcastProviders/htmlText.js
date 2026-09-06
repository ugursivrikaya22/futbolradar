/**
 * PAYLAŞILAN HTML METİN ARAÇLARI — yayın sağlayıcı adaptörleri için.
 *
 * BAĞIMLILIK EKLENMİYOR (bu depoda çalışma zamanı bağımlılığı hiç yok,
 * bkz. services/supabase/client.js başlığı). HTML ayrıştırma bu yüzden
 * gerçek bir DOM değil, düz metne indirgeme + satır bazlı örüntü arama.
 * Bu KIRILGAN bir yöntemdir ve bilerek öyle bırakıldı: kaynağın HTML
 * yapısı değiştiğinde adaptörün ÇÖKMEMESİ, yalnızca boş/eksik sonuç
 * döndürmesi gerekiyor (bkz. beinBroadcastProvider.js ve
 * trtBroadcastProvider.js başlıkları). Bir DOM ayrıştırıcı yanlış
 * girdide fırlatabilir; düz metin taraması asla fırlatmaz.
 */

const TURKISH_MONTHS = [
  "ocak", "şubat", "mart", "nisan", "mayıs", "haziran",
  "temmuz", "ağustos", "eylül", "ekim", "kasım", "aralık"
];

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ccedil: "ç", Ccedil: "Ç", uuml: "ü", Uuml: "Ü", ouml: "ö", Ouml: "Ö",
  scaron: "ş", Scaron: "Ş", "#x15E": "Ş", "#x15F": "ş"
};

function decodeEntities(value) {
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === "#") {
      const isHex = code[1] === "x" || code[1] === "X";
      const num = parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(num) ? String.fromCodePoint(num) : whole;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, code) ? NAMED_ENTITIES[code] : whole;
  });
}

/** HTML → düz metin, blok sınırlarında satır sonu korunarak. */
function htmlToLines(html) {
  const withoutNoise = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const withBreaks = withoutNoise.replace(
    /<\/(p|div|tr|li|h[1-6]|section|article|header|footer|table|thead|tbody)>|<br\s*\/?>/gi,
    "\n"
  );
  const textOnly = decodeEntities(withBreaks.replace(/<[^>]+>/g, " "));
  return textOnly
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * "6 Eylül Pazar", "06 Eylül 2026" gibi bir başlığı ISO güne çevirir.
 * Yıl verilmemişse referans tarihin yılı kullanılır; ay referans aydan
 * belirgin biçimde GERİDEYSE (>6 ay) bir sonraki yıla taşınır — takvim
 * sayfaları yıl dönümünde bile "geçen yıl" değil "gelecek" tarih üretsin.
 */
function parseTurkishDateHeader(line, referenceDate = new Date()) {
  const match = String(line || "").match(
    /(\d{1,2})\s+(ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik)(?:\s+(\d{4}))?/i
  );
  if (!match) return null;

  const day = Number(match[1]);
  const monthToken = match[2].toLowerCase()
    .replace("subat", "şubat").replace("mayis", "mayıs").replace("agustos", "ağustos")
    .replace("eylul", "eylül").replace("kasim", "kasım").replace("aralik", "aralık");
  const monthIndex = TURKISH_MONTHS.indexOf(monthToken);
  if (monthIndex === -1 || day < 1 || day > 31) return null;

  const refYear = referenceDate.getUTCFullYear();
  let year = match[3] ? Number(match[3]) : refYear;
  if (!match[3]) {
    const refMonth = referenceDate.getUTCMonth();
    if (monthIndex < refMonth - 6) year += 1;
  }

  const iso = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/**
 * "Ev Sahibi - Deplasman" örüntüsü. İki taraf da büyük harfle başlayan,
 * en az iki karakterlik bir dizi olmalı — rastgele bir cümledeki tireyi
 * fikstür sanmaması için kaba ama etkili bir süzgeç.
 */
const FIXTURE_LINE_PATTERN = /^([A-ZÇĞİÖŞÜ][\wÇĞİİÖŞÜçğıöşü .'-]{1,38}?)\s*[-–—]\s*([A-ZÇĞİÖŞÜ][\wÇĞİİÖŞÜçğıöşü .'-]{1,38})$/;

function parseFixtureLine(line) {
  const clean = String(line || "").replace(/\s*\(.*?\)\s*$/, "").trim();
  const match = clean.match(FIXTURE_LINE_PATTERN);
  if (!match) return null;
  const home = match[1].trim();
  const away = match[2].trim();
  if (!home || !away || home.length > 40 || away.length > 40) return null;
  return { home, away };
}

/** Satırın en yakın komşularında (kendisi dahil) verilen örüntülerden biri var mı? */
function findChannelNear(lines, index, channelRules, window = 2) {
  const start = Math.max(0, index - window);
  const end = Math.min(lines.length - 1, index + window);
  for (let cursor = start; cursor <= end; cursor += 1) {
    for (const rule of channelRules) {
      const match = lines[cursor].match(rule.pattern);
      if (match) return rule.label(match);
    }
  }
  return null;
}

/**
 * Kaynağı getirip HAM METİN olarak döner. Zaman aşımı ve HTTP hatası
 * burada AYNI ŞEKİLDE ele alınır: fırlatılan hata her zaman kısa ve
 * okunabilir bir mesaj taşır, çağıran adaptör onu yakalayıp
 * `{ ok: false }` sonucuna çevirir — süreç asla çökmez.
 */
async function fetchRaw(url, { fetchImpl = globalThis.fetch, timeoutMs = 10000, headers } = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch-unavailable");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { "User-Agent": "FutbolRadarBroadcastBot/1.0 (+https://www.futbolradar.com)", ...(headers || {}) }
    });
    if (!response || !response.ok) {
      throw new Error(`http-${(response && response.status) || "error"}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Kaynağı getirip düz satırlara çevirir (bkz. fetchRaw). */
async function fetchLines(url, options = {}) {
  return htmlToLines(await fetchRaw(url, options));
}

module.exports = {
  TURKISH_MONTHS,
  decodeEntities,
  fetchLines,
  fetchRaw,
  findChannelNear,
  htmlToLines,
  parseFixtureLine,
  parseTurkishDateHeader
};
