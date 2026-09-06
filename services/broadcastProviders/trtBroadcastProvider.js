/**
 * TRT RESMÎ YAYIN AKIŞI ADAPTÖRÜ.
 *
 * Kaynak: https://www.trt.net.tr/yayin-akisi — TRT 1, TRT Spor ve tabii
 * Spor'un günlük yayın akışı. Türk takımlarının UEFA Şampiyonlar Ligi,
 * UEFA Avrupa Ligi ve UEFA Konferans Ligi maçlarında kullanılır (bkz.
 * görev tanımı). Süper Lig maçları için birincil kaynak beIN SPORTS'tur
 * (beinBroadcastProvider.js); bu adaptör onu YERİNE geçmez, tamamlar.
 *
 * Aynı kırılganlık kabulü beinBroadcastProvider.js ile ortak: HTML yapısı
 * değişirse bu adaptör YANLIŞ bir kanal uydurmak yerine boş sonuç döner.
 */

const { fetchLines, findChannelNear, parseFixtureLine, parseTurkishDateHeader } = require("./htmlText.js");

const SOURCE_NAME = "TRT";
const SOURCE_URL = "https://www.trt.net.tr/yayin-akisi";

/** "TRT 1", "TRT Spor", "TRT Spor Yıldız", "tabii Spor" biçimlerini yakalar. */
const CHANNEL_RULES = [
  { pattern: /trt\s*spor\s*yıldız/i, label: () => "TRT Spor Yıldız" },
  { pattern: /trt\s*spor/i, label: () => "TRT Spor" },
  { pattern: /trt\s*1\b/i, label: () => "TRT 1" },
  { pattern: /tabii\s*spor/i, label: () => "tabii Spor" }
];

/** beinBroadcastProvider.js#extractCandidates ile aynı gün-gruplama kuralı. */
function extractCandidates(lines, now) {
  const candidates = [];
  let currentDate = null;

  lines.forEach((line, index) => {
    const dateHeader = parseTurkishDateHeader(line, now);
    if (dateHeader) {
      currentDate = dateHeader;
      return;
    }

    const fixture = parseFixtureLine(line);
    if (!fixture) return;

    const channel = findChannelNear(lines, index, CHANNEL_RULES, 3);
    if (!channel) return;

    candidates.push({
      homeTeam: fixture.home,
      awayTeam: fixture.away,
      date: currentDate,
      broadcaster: channel,
      platform: channel === "tabii Spor" ? "tabii" : null,
      sourceName: SOURCE_NAME,
      sourceUrl: SOURCE_URL,
      confidence: "official"
    });
  });

  return candidates;
}

async function fetchTrtBroadcastSchedule(options = {}) {
  const { fetchImpl, timeoutMs, now = new Date() } = options;
  try {
    const lines = await fetchLines(SOURCE_URL, { fetchImpl, timeoutMs });
    const matches = extractCandidates(lines, now);
    return { ok: true, provider: "trt", sourceName: SOURCE_NAME, sourceUrl: SOURCE_URL, matches, error: null };
  } catch (error) {
    return {
      ok: false,
      provider: "trt",
      sourceName: SOURCE_NAME,
      sourceUrl: SOURCE_URL,
      matches: [],
      error: String((error && error.message) || error)
    };
  }
}

module.exports = { extractCandidates, fetchTrtBroadcastSchedule, SOURCE_NAME, SOURCE_URL };
