/**
 * PAYLAŞIM METNİ — yalnızca doğrulanmış alanlardan kurulur.
 *
 * NEDEN AYRI BİR MODÜL. Paylaşılan metin siteden KOPUP gider. Yanlış bir
 * skor sayfada düzeltilebilir; paylaşılmış bir gönderide düzeltilemez.
 * Bu yüzden paylaşım metni, sayfanın geri kalanından daha sıkı bir kurala
 * tabi: kayıtta olmayan hiçbir şey cümleye giremez.
 *
 * GİRMEYENLER. Tahmin, oran, "kaçırmayın", "efsane maç" gibi editoryal
 * iddialar; kayıtta bulunmayan skor; üretilmemiş analiz. Skor yoksa cümlede
 * skor geçmez — yerine saat yazılır. Analiz yoksa analiz cümlesi olmaz.
 *
 * BİÇİM. Tek satır metin + bağlantı. Kısa tutuluyor çünkü paylaşım
 * kutularının çoğu uzun metni kırpıyor ve kırpılan yer genelde en anlamlı
 * kısım oluyor.
 */
// DİKKAT: bu iki yüklem MAÇ KAYDI alır, durum dizesi değil.
const { isFinishedStatus, isLiveStatus } = require("./matchStatus");

/** Metin uzunluğu tavanı. X'in 280 sınırının altında, bağlantıya yer kalır. */
const MAX_SHARE_TEXT = 200;

const SITE_NAME = "FutbolRadar";
const SITE_ORIGIN = "https://www.futbolradar.com";

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function scoreOf(match) {
  const score = match && match.score;
  if (!score || typeof score !== "object") return null;
  const home = Number(score.home);
  const away = Number(score.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return { home, away };
}

function clamp(value, limit = MAX_SHARE_TEXT) {
  const raw = text(value);
  if (raw.length <= limit) return raw;
  return `${raw.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * Mutlak adres. Paylaşılan bağlantı göreli olamaz — sayfadan koptuğu anda
 * anlamını yitirir.
 */
function absoluteUrl(pathOrUrl, origin = SITE_ORIGIN) {
  const raw = text(pathOrUrl);
  if (!raw) return `${origin}/`;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${origin}/${raw.replace(/^\.?\//, "")}`;
}

/**
 * Maç için paylaşım metni.
 *
 * @param {Object} match Maç kaydı.
 * @param {Object} [options]
 * @param {string} [options.path] Kalıcı sayfa yolu (rapor ya da analiz sayfası).
 * @param {string} [options.origin] Site kökü.
 * @returns {{text: string, url: string, full: string, evidence: string[]}|null}
 *   Kimlik alanları eksikse `null` — adsız bir maç paylaşılamaz.
 */
function buildMatchShareText(match, options = {}) {
  const home = text(match && match.homeTeam);
  const away = text(match && match.awayTeam);
  if (!home || !away) return null;

  const origin = text(options.origin) || SITE_ORIGIN;
  const url = absoluteUrl(options.path || (match && match.analysisPage), origin);
  const score = scoreOf(match);
  const evidence = ["homeTeam", "awayTeam"];

  let line = "";

  if (isFinishedStatus(match) && score) {
    line = `${home} ${score.home}-${score.away} ${away}`;
    evidence.push("score", "status");

    // Analiz başlığı VARSA eklenir; yoksa cümle skorla yetinir.
    const headline = text(match.analysis && match.analysis.headline);
    if (headline) {
      line += ` — ${headline}`;
      evidence.push("analysis.headline");
    }
  } else if (isLiveStatus(match)) {
    line = score
      ? `CANLI: ${home} ${score.home}-${score.away} ${away}`
      : `CANLI: ${home} – ${away}`;
    evidence.push("status");
    if (score) evidence.push("score");
  } else {
    const time = text(match && match.time);
    line = time ? `${home} – ${away}, bugün ${time} TSİ` : `${home} – ${away}`;
    if (time) evidence.push("time");
  }

  const league = text(match && match.league);
  if (league && line.length + league.length + 3 <= MAX_SHARE_TEXT) {
    line += ` (${league})`;
    evidence.push("league");
  }

  const body = clamp(line);

  return {
    text: body,
    url,
    full: `${body} ${url}`,
    evidence
  };
}

/**
 * Paylaşım hedefleri. Hepsi metni ve adresi sorgu dizesinde taşıyan
 * herkese açık uç noktalar; hiçbiri anahtar ya da SDK gerektirmiyor.
 */
function shareTargets(share) {
  if (!share) return [];

  const encodedText = encodeURIComponent(share.text);
  const encodedUrl = encodeURIComponent(share.url);
  const encodedFull = encodeURIComponent(share.full);

  return [
    { key: "x", label: "X'te paylaş", href: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}` },
    { key: "whatsapp", label: "WhatsApp", href: `https://api.whatsapp.com/send?text=${encodedFull}` },
    { key: "telegram", label: "Telegram", href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}` }
  ];
}

/**
 * Paylaşım bloğunun HTML'i. Metin üretilemiyorsa BOŞ DİZE döner: paylaşacak
 * doğrulanmış bir şey yoksa kutu da çizilmez.
 *
 * Kopyalanacak metin `data-share-text` içinde durur; istemci betiği panoya
 * onu yazar. Böylece kopyalanan metin ekranda görünenle birebir aynı olur.
 */
function renderShareBlock(share, escapeHtml, options = {}) {
  if (!share) return "";
  const escape = typeof escapeHtml === "function" ? escapeHtml : (value) => String(value);
  const heading = text(options.heading) || "Bu maçı paylaş";

  const targets = shareTargets(share).map((target) =>
    `<a class="share-target" href="${escape(target.href)}" target="_blank" rel="noopener noreferrer">${escape(target.label)}</a>`
  ).join("");

  return `<div class="share-block" data-share-block data-share-text="${escape(share.full)}">` +
    `<div class="share-block-head"><span class="share-block-title">${escape(heading)}</span>` +
    `<button type="button" class="share-copy" data-share-copy>Metni kopyala</button></div>` +
    `<p class="share-block-text">${escape(share.text)}</p>` +
    `<div class="share-targets">${targets}</div>` +
    "</div>";
}

module.exports = {
  MAX_SHARE_TEXT,
  SITE_NAME,
  SITE_ORIGIN,
  absoluteUrl,
  buildMatchShareText,
  renderShareBlock,
  shareTargets
};
