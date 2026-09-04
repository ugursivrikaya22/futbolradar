/**
 * SPORX KEŞİF BESLEMESİ — HAM HTML'DEN ADAY LİSTESİNE.
 *
 * Sporx RSS sunmuyor (bkz. scripts/sync-football-news.mjs'teki gerekçe:
 * Sporx daha önce RSS beslemesi için değerlendirilmiş ve reddedilmişti).
 * Bu yüzden bu modül Sporx'in futbol anasayfasını doğrudan HTML olarak
 * çeker ve manşet kartlarını (`div.newslist-imageview`) ayrıştırır.
 *
 * SADECE KEŞİF. Buradan çıkan her aday yalnızca {başlık, özet, bağlantı,
 * görsel} taşır — hiçbir gövde metni çekilmez, hiçbir görsel indirilmez.
 * Özgün yeniden yazım `services/sporxNews.js`'te, yalnızca bu üç alandan
 * OLAY çıkarımı yaparak yapılır.
 */

const LIST_URL = "https://www.sporx.com/futbol/";
const REQUEST_TIMEOUT_MS = 15000;
const USER_AGENT = "Mozilla/5.0 (compatible; FutbolRadarBot/1.0; +https://www.futbolradar.com)";

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function normalizeSporxUrl(href) {
  const raw = String(href || "").trim();
  if (!raw) return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("/")) return `https://www.sporx.com${raw}`;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://www.sporx.com/${raw}`;
}

async function fetchDecoded(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "tr-TR,tr;q=0.9" }
    });
    if (!response.ok) {
      throw new Error(`Sporx isteği başarısız: ${response.status} ${response.statusText} (${url})`);
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    // Sporx sayfaları windows-1254 (Türkçe Latin-5) ile yayımlanıyor.
    return new TextDecoder("windows-1254").decode(buffer);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `div.newslist-imageview` kartlarını ayrıştırır. Bu blok Sporx'in
 * anasayfasında hem manşet hem alt liste kartlarında tutarlı biçimde
 * kullanılıyor: bağlantı + `img[alt]` başlık + `h2.iv-title` + isteğe
 * bağlı `p.iv-desc`.
 */
function parseCandidates(html) {
  const candidates = [];
  const seenUrls = new Set();
  const blockPattern = /<div class="newslist-imageview">([\s\S]*?)<\/div>\s*<\/div>/g;
  let blockMatch;

  while ((blockMatch = blockPattern.exec(html))) {
    const block = blockMatch[1];
    const hrefMatch = block.match(/<a href="([^"]+)"/);
    const titleMatch = block.match(/<h2 class="iv-title"><a[^>]*>([^<]*)<\/a><\/h2>/);
    const descMatch = block.match(/<p class="iv-desc"><a[^>]*>([^<]*)<\/a><\/p>/);
    const imageMatch = block.match(/<img[^>]*src="([^"]+)"/);

    if (!hrefMatch || !titleMatch) continue;

    const url = normalizeSporxUrl(hrefMatch[1]);
    const title = decodeEntities(titleMatch[1]);
    if (!url || !title || seenUrls.has(url)) continue;
    seenUrls.add(url);

    candidates.push({
      url,
      title,
      summary: descMatch ? decodeEntities(descMatch[1]) : "",
      imageUrl: imageMatch ? decodeEntities(imageMatch[1]) : ""
    });
  }

  return candidates;
}

/** Sporx futbol anasayfasından aday listesi çeker. Ağ hatasında boş dizi döner. */
async function fetchSporxCandidates({ url = LIST_URL } = {}) {
  try {
    const html = await fetchDecoded(url);
    return parseCandidates(html);
  } catch (error) {
    console.warn(`[sporx-feed] liste çekilemedi: ${error && error.message}`);
    return [];
  }
}

/**
 * Bir Sporx haberinin JSON-LD `datePublished` alanını çeker. Bulunamazsa
 * ya da istek başarısız olursa `null` döner — UYDURMA YAPILMAZ, çağıran
 * taraf o zaman keşif anını yayım zamanı olarak kullanır.
 */
async function fetchArticlePublishedAt(url) {
  try {
    const html = await fetchDecoded(url);
    const match = html.match(/"datePublished"\s*:\s*"([^"]+)"/);
    if (!match) return null;
    // Sporx zaman damgası saat dilimi taşımaz ama TSİ (Europe/Istanbul,
    // UTC+3) cinsindendir. Ofset eklenmezse JS bunu makinenin yerel saati
    // sayar; CI koşucuları UTC olduğu için haber "geleceğe tarihli" görünür
    // ve bant/haber doğrulaması onu reddeder.
    const parsed = new Date(`${match[1].replace(" ", "T")}+03:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  } catch (error) {
    console.warn(`[sporx-feed] yayım tarihi çekilemedi (${url}): ${error && error.message}`);
    return null;
  }
}

export {
  LIST_URL,
  decodeEntities,
  normalizeSporxUrl,
  parseCandidates,
  fetchSporxCandidates,
  fetchArticlePublishedAt
};
