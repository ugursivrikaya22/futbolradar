#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { validateTickerItem } = require("../services/newsTicker.js");
const SOURCE_TRUST = require("../services/sourceTrust.js");
const { fixtureTeamNames } = require("../services/superLigTeams.js");

const root = process.cwd();
const OUTPUT_PATH = path.join(root, "data", "news-ticker.json");
const PUBLIC_OUTPUT_PATH = path.join(root, "public", "data", "news-ticker.json");
const REQUEST_TIMEOUT_MS = 12_000;
const REQUEST_RETRIES = 2;
const MAX_AUTOMATED_ITEMS = 18;
const MAX_AGE_MS = 96 * 60 * 60 * 1000;

// KAYNAK LİSTESİ TEK YERDE: services/sourceTrust.js.
//
// Bu dosya kendi kısaltılmış listesini taşıyordu (yedi alan adı) ve servis
// büyüdükçe ikisi ayrışıyordu. Aynı kuralın iki kopyası, bu depoda daha önce
// canlıda 404 veren haber bağlantılarını doğurmuştu; tekrarlamıyoruz.
const OFFICIAL_DOMAINS = SOURCE_TRUST.OFFICIAL_DOMAINS;
const TRUSTED_DOMAINS = [...SOURCE_TRUST.OFFICIAL_DOMAINS, ...SOURCE_TRUST.HIGH_TRUST_DOMAINS];

function googleNewsUrl(query, language = "tr") {
  const locale = language === "en" ? { hl: "en-GB", gl: "GB", ceid: "GB:en" } : { hl: "tr", gl: "TR", ceid: "TR:tr" };
  const params = new URLSearchParams({ q: query, ...locale });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

/**
 * BESLEME LİSTESİ — İKİ FARKLI MEKANİZMA, İKİ FARKLI NEDENLE.
 *
 * ── scope: "team" — GOOGLE NEWS ÜZERİNDEN RESMÎ KULÜP SİTELERİ ───────────
 * Resmî kulüp siteleri RSS YAYINLAMIYOR ve otomatik erişimi engelliyor.
 * Ölçüldü: galatasaray.org 503, fenerbahce.org 403, bjk.com.tr 403,
 * tff.org 503; trabzonspor.org.tr yanıt veriyor ama RSS'i yok. Bu yüzden
 * o kaynaklara tek meşru yol Google News'ün `site:` aramaları.
 *
 * Bedeli açık: Google News'in `<link>` alanı yayıncının makale adresi değil,
 * `news.google.com/rss/articles/...` yönlendirmesi. Özgün adres GERİ
 * GETİRİLEMİYOR — base64 yükü artık URL taşımıyor ve yönlendirme istemci
 * tarafında JavaScript ile yapılıyor (sunucu 200 dönüyor). İkisi de denendi.
 * Bu kayıtlarda `publisher` alanı hangi kurumun yayımladığını söyler; adres
 * ise toplayıcıya gider.
 *
 * ── scope: "general" — DOĞRUDAN YAYINCI BESLEMELERİ ──────────────────────
 * Bunlar yayıncının kendi RSS'i: bağlantı GERÇEK makale adresi. Karşılığında
 * beslemeler tüm spor dallarını taşıyor ve takıma bağlı değil; bu yüzden
 * `scope: "general"` olan besleme için başlıkta TANINAN BİR KULÜP ya da
 * yarışma geçmesi ŞART (bkz. teamFromTitle). Şart olmasaydı bant voleybol
 * ve basketbol başlıklarıyla dolardı.
 *
 * Listedeki her adres bu ortamdan tek tek denendi; yanıt vermeyen ya da RSS
 * sunmayan aday (Fanatik, Sporx, Ajansspor, Milliyet, beIN TR, Guardian,
 * ESPN) listeye HİÇ alınmadı — çalışmayan kaynağı "izleniyor" diye taşımak
 * gözlem panelini de yanıltırdı.
 */
export const DEFAULT_FEEDS = [
  // Tier 1 — resmî kulüp/federasyon (yalnızca Google News üzerinden erişilebiliyor)
  { id: "galatasaray", scope: "team", officialDomain: "galatasaray.org", team: "Galatasaray", priority: 1, url: googleNewsUrl("Galatasaray futbol site:galatasaray.org") },
  { id: "fenerbahce", scope: "team", officialDomain: "fenerbahce.org", team: "Fenerbahçe", priority: 2, url: googleNewsUrl("Fenerbahçe futbol site:fenerbahce.org") },
  { id: "besiktas", scope: "team", officialDomain: "bjk.com.tr", team: "Beşiktaş", priority: 3, url: googleNewsUrl("Beşiktaş futbol site:bjk.com.tr") },
  { id: "trabzonspor", scope: "team", officialDomain: "trabzonspor.org.tr", team: "Trabzonspor", priority: 4, url: googleNewsUrl("Trabzonspor futbol site:trabzonspor.org.tr") },
  { id: "super-lig", scope: "team", officialDomain: "tff.org", team: "Süper Lig", priority: 5, url: googleNewsUrl("Süper Lig futbol site:tff.org") },
  { id: "uefa", scope: "team", officialDomain: "uefa.com", team: "Avrupa futbolu", priority: 9, url: googleNewsUrl("UEFA football site:uefa.com", "en") },

  // Tier 2 — doğrudan Türk spor medyası beslemeleri (gerçek makale adresi)
  { id: "aa-spor", scope: "general", officialDomain: "aa.com.tr", trusted: true, priority: 6, url: "https://www.aa.com.tr/tr/rss/default?cat=spor" },
  { id: "trt-spor", scope: "general", officialDomain: "trtspor.com.tr", trusted: true, priority: 6, url: "https://www.trtspor.com.tr/rss/futbol.rss" },
  { id: "trt-haber", scope: "general", officialDomain: "trthaber.com", trusted: true, priority: 7, url: "https://www.trthaber.com/spor_articles.rss" },
  { id: "hurriyet-spor", scope: "general", officialDomain: "hurriyet.com.tr", trusted: true, priority: 7, url: "https://www.hurriyet.com.tr/rss/spor" },
  { id: "fotomac", scope: "general", officialDomain: "fotomac.com.tr", trusted: true, priority: 8, url: "https://www.fotomac.com.tr/rss/anasayfa.xml" },
  { id: "sabah-spor", scope: "general", officialDomain: "sabah.com.tr", trusted: true, priority: 8, url: "https://www.sabah.com.tr/rss/spor.xml" },

  // Tier 3 — uluslararası (Türk futbolu geçmiyorsa banda hiç girmez)
  { id: "bbc-football", scope: "general", officialDomain: "bbc.co.uk", trusted: true, priority: 10, url: "https://feeds.bbci.co.uk/sport/football/rss.xml" },
  { id: "sky-football", scope: "general", officialDomain: "skysports.com", trusted: true, priority: 10, url: "https://www.skysports.com/rss/12040" }
];

function decodeXml(value) {
  return String(value || "")
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&#(x?[0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code.replace(/^x/i, ""), /^x/i.test(code) ? 16 : 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .trim();
}

function tagValue(block, tag) {
  const match = String(block).match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function sourceFromBlock(block) {
  const match = String(block).match(/<source(?:\s+url=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/source>/i);
  return match ? { url: decodeXml(match[1]), name: decodeXml(match[2]) } : { url: "", name: "" };
}

export function parseRss(xml, feed = {}) {
  const blocks = [...String(xml || "").matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((match) => match[2]);
  return blocks.map((block) => {
    const source = sourceFromBlock(block);
    const atomLink = String(block).match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i);
    return {
      title: tagValue(block, "title"),
      link: tagValue(block, "link") || decodeXml(atomLink && atomLink[1]),
      guid: tagValue(block, "guid") || tagValue(block, "id"),
      publishedAt: tagValue(block, "pubDate") || tagValue(block, "published") || tagValue(block, "updated"),
      sourceName: source.name || feed.name || feed.id || "Football news feed",
      sourceUrl: source.url || feed.sourceUrl || feed.url || "",
      feed
    };
  }).filter((item) => item.title && item.link && !Number.isNaN(Date.parse(item.publishedAt)));
}

function hostname(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function domainAllowed(domain, allowed) {
  if (!domain) return false;
  return allowed.some((entry) => domain === entry || domain.endsWith(`.${entry}`));
}

/**
 * YAYINCI — HABERİ GERÇEKTE KİM YAYIMLADI?
 *
 * Öncelik RSS'in kendi `<source url>` alanıdır. O okunamadığında besleme
 * tanımındaki `officialDomain` kullanılır ve bu bir TAHMİN DEĞİLDİR:
 * beslemeler `site:fenerbahce.org` biçiminde alan adına daraltılmış
 * aramalardır, dolayısıyla o beslemeden gelen her öğe tanım gereği o alanda
 * yayımlanmıştır.
 *
 * Bu boşluk depoda görünür haldeydi: banttaki dört Fenerbahçe öğesi
 * `publisher: null` taşırken "Resmî açıklama" rozetiyle gösteriliyordu.
 * Rozet okuyucuya kulübün konuştuğunu söylüyor ama kayıt hangi kurumun
 * konuştuğunu söyleyemiyordu.
 */
function publisherOf(item) {
  return hostname(item.sourceUrl) || (item.feed && item.feed.officialDomain) || "";
}

function isOfficial(item) {
  return domainAllowed(publisherOf(item), OFFICIAL_DOMAINS);
}

function isTrusted(item) {
  return item.feed.trusted === true || domainAllowed(hostname(item.sourceUrl), TRUSTED_DOMAINS);
}

/**
 * BAŞKA BRANŞ, BAŞKA SİTE.
 *
 * Beslemeler kulüplerin resmî sitelerine daraltılmış ("site:galatasaray.org")
 * ama o siteler çok şubeli: basketbol, voleybol, atletizm... Google bunları
 * ayırmıyor, dolayısıyla bir FUTBOL bandına "Erkek Basketbol Takımımız yeni
 * sezon hazırlıklarına başlıyor" ve basketbol transferleri düşüyordu.
 * Okuyucu için bu yanlış bilgi değil, ALAKASIZ bilgi — ama bant "gündem"
 * diyorsa gündemi futbol olmalı.
 *
 * Eleme YALNIZCA başlık üzerinden ve açık işaretlerle yapılır: branş adları
 * ve kulüplerin futbol dışı takım markaları. Gövde metnine bakılmaz, çünkü
 * bir futbol haberinde geçen "basketbol" kelimesi haberi basketbol yapmaz.
 */
const OTHER_SPORT_PATTERNS = [
  /basketbol/i,
  /voleybol/i,
  /hentbol/i,
  /atletizm/i,
  /\batlet(?:ler|imiz|leri)?\b/i,
  /yelken/i,
  /\bboks\b/i,
  /yüzme/i,
  /masa tenisi/i,
  /buz hokeyi/i,
  /satranç/i,
  /\be-?spor/i,
  /badminton/i,
  /\bkürek\b/i,
  /cimnastik|jimnastik/i,
  /tekerlekli sandalye/i,
  /\bgüreş\b/i,
  /taekwondo|karate|\bjudo\b/i,
  /okçuluk|eskrim|halter|triatlon|kürek/i,
  /bisiklet/i,
  /\bşubemiz\b/i,
  // Kulüplerin futbol dışı takım/sponsor markaları.
  /mct technic/i,
  /\bbeko\b/i,
  /daikin/i,
  /eczacıbaşı/i
];

/**
 * Başlıkta hem branş işareti hem "futbol" geçiyorsa haber futboldur
 * ("Futbol Takımımız ... basketbol takımıyla ortak antrenman"). Elemenin
 * kapsamı bilinçli olarak dar: şüphede kalırsa haber BANTTA KALIR, çünkü
 * yanlış eleme gerçek bir futbol haberini gizler.
 */
function isFootballTopic(item) {
  const title = String((item && item.title) || "");
  if (/futbol/i.test(title)) return true;
  return !OTHER_SPORT_PATTERNS.some((pattern) => pattern.test(title));
}

/**
 * BAŞLIKTAN TAKIM ÇIKARIMI — KULÜP LİSTESİ UYDURULMAZ, FİKSTÜRDEN GELİR.
 *
 * `services/superLigTeams.js` bu sezon ligde olan takımları fikstürden
 * türetiyor; liste burada elle yazılsaydı kadro değiştiğinde iki yer
 * ayrışırdı (bu depoda aynı hatanın bedeli daha önce ödendi).
 *
 * Eşleştirme başlıkta ve aksan/büyük harf nötr yapılır. Kısa adlar
 * ("Amed") kelime sınırıyla aranır ki rastgele bir alt dizeye yapışmasın.
 */
const TEAM_MATCHERS = (() => {
  const names = new Set(fixtureTeamNames());
  // Fikstürde geçmeyen ama haberde sık anılan çatı başlıklar.
  const extra = [
    ["Süper Lig", /süper lig|super lig|trendyol süper/i],
    ["Milli Takım", /milli takım|a milli|türkiye a milli/i],
    ["TFF", /\btff\b|türkiye futbol federasyonu/i]
  ];

  const fromFixture = [...names].map((name) => {
    // "Gençlerbirliği S.K." → çekirdek ad; sonek eşleşmeyi zorlaştırıyor.
    const core = name.replace(/\s+(S\.?K\.?|A\.?Ş\.?|FK|SK)$/i, "").trim();
    const escaped = core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [name, new RegExp(`(^|[^\\p{L}])${escaped}([^\\p{L}]|$)`, "iu")];
  });

  return [...fromFixture, ...extra];
})();

export function teamFromTitle(title) {
  const value = String(title || "");
  for (const [name, pattern] of TEAM_MATCHERS) {
    if (pattern.test(value)) return name;
  }
  return null;
}

/**
 * Bu öğe banda girebilir mi?
 *
 * `scope: "team"` beslemeler zaten alan adına daraltılmış aramalar; takım
 * beslemenin kendisinden bilinir. `scope: "general"` beslemelerde ise
 * başlıkta tanınan bir kulüp/yarışma GEÇMEK ZORUNDA — yoksa öğe Türk
 * futboluyla ilgili olmayabilir ve bant "gündem" olmaktan çıkar.
 */
function inScope(item) {
  if (!item || !item.feed) return false;
  if (item.feed.scope !== "general") return true;
  return Boolean(teamFromTitle(item.title));
}

function classify(item) {
  const text = item.title.toLocaleLowerCase("tr-TR");
  if (/transfer|imza|kiral|bonservis/.test(text)) return isOfficial(item) ? "official" : "transfer-rumour";
  if (/sakat|ceza|kadro|ilk 11|lineup/.test(text)) return "squad-update";
  if (/maç sonucu|mac sonucu|full.?time|final score/.test(text)) return "post-match";
  return isOfficial(item) ? "official" : "club-agenda";
}

/**
 * ALAKA PUANI — BANDA NE GİRECEĞİNE SIRA DEĞİL, DEĞER KARAR VERİR.
 *
 * Sıralama önceden yalnızca `feed.priority`ye bakıyordu. Doğrudan yayıncı
 * beslemeleri eklenince bu ANINDA kırıldı: resmî kulüp beslemeleri öncelik
 * 1-5 taşıdığı için 18 yuvanın tamamını dolduruyor, yeni beslemelerden tek
 * bir haber bile banda giremiyordu. Ölçüldü: 20 kabul, 18'i tek mekanizmadan.
 *
 * Puan, kaynağın SIRASINI değil haberin DEĞERİNİ ölçüyor. Ağırlıklar
 * (resmî +40, dört büyükler +25, ilk 11 +30, transfer +25, sakatlık/ceza
 * +20, federasyon kararı +30, doğrulanmamış söylenti -20) doğrudan istenen
 * şemadan; tazelik ve tek-besleme baskınlığı buna eklendi.
 *
 * TÜRK FUTBOLU ÖNCELİĞİ puanın içinde: takımı çıkarılamayan uluslararası
 * haber taban puan alır ve Türk futbolu haberlerinin önüne geçemez.
 */
const BIG_FOUR = /galatasaray|fenerbah|beşiktaş|besiktas|trabzonspor/i;
const FEDERATION = /\btff\b|türkiye futbol federasyonu|uefa|fifa/i;

export function relevanceScore(item, options = {}) {
  const nowMs = options.nowMs || Date.now();
  const title = String((item && item.text) || "");
  const team = String((item && item.team) || "");
  const category = String((item && item.category) || "");
  const confidence = String((item && item.confidence) || "");
  let score = 0;

  if (category === "official" || confidence === "confirmed") score += 40;
  if (BIG_FOUR.test(`${team} ${title}`)) score += 25;
  if (/ilk 11|kadro açıklandı|muhtemel 11|lineup|kamp kadrosu/i.test(title)) score += 30;
  if (/transfer|imza|bonservis|kiral|sözleşme/i.test(title)) score += 25;
  if (/sakat|ceza|kart|men edildi|kadro dışı/i.test(title)) score += 20;
  if (FEDERATION.test(title)) score += 30;
  if (confidence === "reported" && /iddia|söylenti|kulis|görüşüyor|istiyor/i.test(title)) score -= 20;

  // Türk futbolu önceliği: takımı olmayan (uluslararası) haber taban kalır.
  if (team) score += 15;

  // Tazelik: ilk 6 saat tam, sonra saat başına bir puan erir (en çok -24).
  const ageHours = Math.max(0, (nowMs - Date.parse(item && item.timestamp)) / 3_600_000);
  score -= Math.min(24, Math.max(0, ageHours - 6));

  return Math.round(score);
}

function automatedId(item) {
  const input = item.guid || `${item.sourceUrl}|${item.link}|${item.title}`;
  return `auto-news-${crypto.createHash("sha256").update(input).digest("hex").slice(0, 20)}`;
}

export function toTickerItem(item) {
  const official = isOfficial(item);
  return {
    id: automatedId(item),
    category: classify(item),
    confidence: official ? "confirmed" : "reported",
    section: /transfer|imza|kiral|bonservis/i.test(item.title) ? "transfer" : "news",
    text: item.title.replace(/\s+-\s+[^-]+$/, "").trim(),
    // Takım: takıma bağlı beslemede beslemeden, genel beslemede başlıktan.
    team: item.feed.team || teamFromTitle(item.title) || null,
    timestamp: new Date(item.publishedAt).toISOString(),
    // `url` toplayıcı üzerinden yazının kendisine gider; `publisher` ise
    // haberin gerçekte hangi kurumda yayımlandığını kayıtta tutar. İkisi
    // ayrı durur ki kaydı okuyan (ya da denetleyen) kimse bağlantının
    // hedefiyle kaynağın kimliğini birbirine karıştırmasın.
    source: { name: item.sourceName, url: item.link, publisher: publisherOf(item) || null },
    automation: { source: "rss", feed: item.feed.id || item.feed.url, priority: item.feed.priority || 99 }
  };
}

function configuredFeeds() {
  const raw = String(process.env.FOOTBALL_NEWS_FEEDS || "").trim();
  if (!raw) return DEFAULT_FEEDS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) throw new Error("expected a non-empty JSON array");
    return parsed.map((feed, index) => ({ priority: index + 1, trusted: true, ...feed }));
  } catch (error) {
    throw new Error(`FOOTBALL_NEWS_FEEDS is invalid: ${error.message}`);
  }
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= REQUEST_RETRIES + 1; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt <= REQUEST_RETRIES) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function comparable(items) {
  return JSON.stringify((items || []).map((item) => ({ ...item, automation: item.automation || undefined })));
}

export function mergeNewsItems(payload, incoming, options = {}) {
  const nowMs = options.nowMs || Date.now();
  const existing = Array.isArray(payload && payload.items) ? payload.items : [];
  const curated = existing.filter((item) => !item.automation);
  // Branş süzgeci saklanan kayıtlara da uygulanır. Yalnızca girişte süzmek,
  // süzgeç eklenmeden önce banda düşmüş basketbol/voleybol başlıklarının
  // raf ömrü dolana kadar orada kalması demekti.
  const retainedAutomated = existing.filter((item) =>
    item.automation &&
    nowMs - Date.parse(item.timestamp) <= MAX_AGE_MS &&
    isFootballTopic({ title: item.text }));
  const byId = new Map(retainedAutomated.map((item) => [item.id, item]));
  for (const item of incoming || []) byId.set(item.id, item);
  // TEK BESLEME BANDI ELE GEÇİREMEZ.
  //
  // Puan tek başına yetmiyor: aynı kulübün resmî beslemesi aynı gün beş
  // yüksek puanlı haber üretebiliyor ve bant tek kulübün duyuru panosuna
  // dönüyordu. Besleme başına tavan, çeşitliliği puanı bozmadan koruyor.
  const PER_FEED_LIMIT = 4;
  const usedByFeed = new Map();
  const automated = [...byId.values()]
    .filter((item) => nowMs - Date.parse(item.timestamp) <= MAX_AGE_MS)
    .map((item) => ({ item, score: relevanceScore(item, { nowMs }) }))
    .sort((left, right) => right.score - left.score
      || Number(left.item.automation.priority) - Number(right.item.automation.priority)
      || String(right.item.timestamp).localeCompare(String(left.item.timestamp)))
    .filter((row) => {
      const feed = String(row.item.automation.feed || "");
      const used = usedByFeed.get(feed) || 0;
      if (used >= PER_FEED_LIMIT) return false;
      usedByFeed.set(feed, used + 1);
      return true;
    })
    .slice(0, MAX_AUTOMATED_ITEMS)
    .map((row) => row.item);
  const items = [...automated, ...curated];
  return { items, changed: comparable(items) !== comparable(existing), automated: automated.length, curated: curated.length };
}

export async function synchronizeFootballNews(options = {}) {
  const feeds = options.feeds || configuredFeeds();
  const now = options.now || new Date();
  const errors = [];
  const candidates = [];
  let checked = 0;

  for (const feed of feeds) {
    try {
      const xml = options.fetchText ? await options.fetchText(feed.url, feed) : await fetchText(feed.url);
      checked += 1;
      // ALIM, ÇIKIŞ TAVANINDAN GENİŞ OLMALI.
      //
      // Her beslemeden puanlamadan ÖNCE beşer öğe alınıyordu. Doğrudan
      // yayıncı beslemeleri eklenince bu bir darboğaza dönüştü: Fotomaç'ın
      // beslemesinde 40 Türk futbolu başlığı varken 5'i görülüyor, kalan 35
      // puanlanmadan atılıyordu. Genel beslemeler tüm spor dallarını
      // taşıdığı için ilk beş öğe çoğu zaman futbol bile olmuyor.
      //
      // Alım genişletildi; bandı tek beslemenin doldurmasını ÇIKIŞ tavanı
      // (PER_FEED_LIMIT) zaten engelliyor. Puanlama böylece gerçek adayları
      // görüyor, ilk beşin sırasını değil.
      const intake = feed.scope === "general" ? 25 : 8;
      candidates.push(...parseRss(xml, feed).slice(0, intake));
    } catch (error) {
      errors.push({ source: feed.id || feed.url, message: error.message });
    }
  }
  if (!checked) throw new Error(`All football news feeds failed: ${errors.map((item) => item.source).join(", ")}`);

  const cutoff = now.getTime() - MAX_AGE_MS;
  const accepted = [];
  const seen = new Set();
  for (const candidate of candidates
    .filter((item) => Date.parse(item.publishedAt) >= cutoff && isTrusted(item) && isFootballTopic(item) && inScope(item))
    .sort((left, right) => Number(left.feed.priority || 99) - Number(right.feed.priority || 99) || Date.parse(right.publishedAt) - Date.parse(left.publishedAt))) {
    const tickerItem = toTickerItem(candidate);
    const verdict = validateTickerItem(tickerItem);
    if (!verdict.valid || seen.has(tickerItem.id)) continue;
    seen.add(tickerItem.id);
    accepted.push(tickerItem);
  }

  const previous = options.previous || JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
  const merged = mergeNewsItems(previous, accepted, { nowMs: now.getTime() });
  return {
    output: merged.changed ? { ...previous, updatedAt: now.toISOString(), items: merged.items } : previous,
    summary: { source: "rss", feedsChecked: checked, candidates: candidates.length, accepted: accepted.length, updated: merged.changed ? accepted.length : 0, errors },
    changed: merged.changed
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const result = await synchronizeFootballNews();
  if (apply && result.changed) {
    atomicWrite(OUTPUT_PATH, result.output);
    if (fs.existsSync(path.dirname(PUBLIC_OUTPUT_PATH))) atomicWrite(PUBLIC_OUTPUT_PATH, result.output);
  }
  console.log(`[football-news] feeds=${result.summary.feedsChecked} candidates=${result.summary.candidates} accepted=${result.summary.accepted} errors=${result.summary.errors.length}`);
  if (!result.changed) console.log("[football-news] No news item changed; the curated ticker file was not rewritten.");
  else if (!apply) console.log("[football-news] Dry run; use --apply to persist changes.");
  console.log(`FUTBOLRADAR_STEP_SUMMARY ${JSON.stringify(result.summary)}`);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(`[football-news] ${error.message}`);
    process.exitCode = 1;
  });
}
