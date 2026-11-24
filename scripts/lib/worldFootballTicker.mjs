/**
 * DÜNYA FUTBOLU BANDI — yalnızca kamuya açık RSS/Atom.
 *
 * Başlık, kaynağın kendi cümlesidir. Türkçe metin ya çeviri ucundan gelen
 * birebir karşılıktır ya da çeviri yokken kaynağın kendi dilindeki başlıktır
 * (dil etiketiyle). Skor, oyuncu veya tarih eklenmez.
 *
 * Açık yayını olmayan kaynaklar WORLD_SKIPPED içindedir ve hiç istenmez.
 */
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { parseRss } from "../sync-football-news.mjs";

const require = createRequire(import.meta.url);
const { isAllowedSourceUrl } = require("../../services/sourceLinks.js");
const { validateTickerItem } = require("../../services/newsTicker.js");

export const TRANSLATE_URL_ENV = "FUTBOLRADAR_TICKER_TRANSLATE_URL";
export const FRESHNESS_MS = 48 * 60 * 60 * 1000;
export const WORLD_ORIGIN = "world-rss";
export const MAX_STORED = 12;
export const PER_FEED = 4;

/** Çalışan, yayıncının kendi sunduğu beslemeler. */
export const WORLD_FEEDS = Object.freeze([
  {
    id: "bbc-football",
    name: "BBC Sport",
    lang: "en",
    url: "https://feeds.bbci.co.uk/sport/football/rss.xml"
  },
  {
    id: "marca-laliga",
    name: "Marca",
    lang: "es",
    url: "https://www.marca.com/rss/futbol/primera-division.xml"
  },
  {
    id: "gazzetta-calcio",
    name: "Gazzetta dello Sport",
    lang: "it",
    url: "https://www.gazzetta.it/dynamic-feed/rss/section/Calcio.xml"
  },
  {
    id: "transfermarkt",
    name: "Transfermarkt",
    lang: "en",
    url: "https://www.transfermarkt.co.uk/rss/news"
  }
]);

/**
 * Denendi, banda alınmadı. Gerekçe dry-run çıktısında da basılır.
 * Bu adreslere istek atılmaz.
 */
export const WORLD_SKIPPED = Object.freeze([
  {
    id: "uefa",
    name: "UEFA",
    reason: "Kamuya açık RSS/Atom yok. Denenen adresler HTML 404 döndürüyor: https://www.uefa.com/rssfeed/news/rss.xml, https://www.uefa.com/rssfeeds/uefachampionsleague.xml, https://editorial.uefa.com/rss ve https://feeds.feedburner.com/uefa."
  },
  {
    id: "fifa",
    name: "FIFA",
    reason: "Kamuya açık RSS/Atom yok. https://www.fifa.com/rss HTML sayfa, https://inside.fifa.com/rss ise 405 dönüyor."
  },
  {
    id: "flashscore",
    name: "Flashscore",
    reason: "Kamuya açık haber akışı yok. https://www.flashscore.com/rss/ 404. Site otomatik erişimi de engelliyor; kazıma yapılmaz."
  },
  {
    id: "transfermarkt-com",
    name: "Transfermarkt.com",
    reason: "transfermarkt.com istekleri WAF doğrulamasına düşüyor, RSS değil. Haberler transfermarkt.co.uk adresindeki açık RSS'ten alınır."
  },
  {
    id: "gazzetta-frozen",
    name: "Gazzetta klasik RSS",
    reason: "https://www.gazzetta.it/rss/calcio.xml, /rss/home.xml ve /rss/ultimora.xml yanıt veriyor ama içlerindeki haberler aylar/yıllar eski. Güncel akış https://www.gazzetta.it/dynamic-feed/rss/section/Calcio.xml."
  }
]);

const SCOPE = [
  /galatasaray|fenerbah[cç]e|be[sş]ikta[sş]|trabzonspor|s[uü]per lig|super lig/i,
  /premier league|champions league|europa league|conference league|la liga|laliga|serie a|bundesliga|ligue 1/i,
  /world cup|d[uü]nya kupas|qualif|eleme|nations league|uluslar ligi/i,
  /real madrid|barcelona|atl[eé]tico|manchester united|man united|man utd|manchester city|man city|arsenal|chelsea|liverpool|tottenham|aston villa/i,
  /juventus|\binter\b|\bmilan\b|napoli|bayern|dortmund|psg|paris saint/i
];

const OTHER_SPORT = /tennis|golf|formula|motogp|\bnba\b|basket|rugby|cricket|\bnfl\b|cycling|ciclismo/i;
const NOISE = /fantacalcio|fantacampionato|fantasy|combined xi|most valuable|team of the week|flop 11|top 11/i;

const CLAIM = /want|wants|offer|bid|target|targeting|eyeing|linked|rumour|rumor|reportedly|in talks|set to join|could join|interested|fichaje|fichar|interesad|podr[ií]a|seg[uú]n|negocia|oferta|trattativa|calciomercato|potrebbe|secondo|iddia|s[oö]ylenti|g[oö]r[uü][sş]me/i;
const RESULT = /\b\d{1,2}\s*[-–]\s*\d{1,2}\b|\bbeat\b|\bdefeats?\b|\bdraws?\b|\bgana\b|\bvince\b|\bpareggia/i;
const SQUAD = /injur|lesione|infortun|sakat|sidelined|out for|kadro/i;

const CONFIRMATION = ["resmen", "imzaladı", "imzayı attı", "duyurdu", "kesinleşti", "anlaşma sağlandı", "transferi tamamlandı"];

export function canonicalArticleUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    for (const key of ["at_medium", "at_campaign", "utm_source", "utm_medium", "utm_campaign", "intcmp"]) {
      url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

export function inWorldScope(title) {
  const text = String(title || "");
  if (OTHER_SPORT.test(text) || NOISE.test(text)) return false;
  return SCOPE.some((pattern) => pattern.test(text));
}

export function isTransferClaim(title) {
  return CLAIM.test(String(title || ""));
}

function numberTokens(value) {
  return (String(value).match(/\d+(?:[.,]\d+)?/g) || []).join("|");
}

function usableTitle(title) {
  const value = String(title || "").replace(/\s+/g, " ").trim();
  if (value.length < 20) return "";
  if (value.split(" ").length < 3) return "";
  return value;
}

function hedgeText(title, claim) {
  const value = usableTitle(title);
  if (!value) return "";
  if (!claim) return value;
  if (/iddia|claim|reportedly|seg[uú]n|secondo/i.test(value)) return value;
  return `İddia: ${value}`;
}

function contradictsClaim(text) {
  const lower = String(text || "").toLocaleLowerCase("tr");
  return CONFIRMATION.some((verb) => lower.includes(verb));
}

export function classifyHeadline(title) {
  if (isTransferClaim(title)) return { category: "transfer-rumour", confidence: "claim" };
  if (RESULT.test(title)) return { category: "post-match", confidence: "confirmed" };
  if (SQUAD.test(title)) return { category: "squad-update", confidence: "confirmed" };
  return { category: "club-agenda", confidence: "confirmed" };
}

export async function translateHeadline(text, source, target, options = {}) {
  const endpoint = String(options.url ?? process.env[TRANSLATE_URL_ENV] ?? "").trim();
  if (!endpoint || source === target) return null;
  const fetchImpl = options.fetch || globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 8000);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ text, source, target })
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const translated = String((payload && (payload.text || payload.translatedText)) || "").replace(/\s+/g, " ").trim();
    if (!translated || translated === text) return null;
    if (translated.length > Math.max(180, text.length * 2)) return null;
    if (numberTokens(translated) !== numberTokens(text)) return null;
    if (/[\r\n]/.test(translated)) return null;
    return translated;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function worldId(url) {
  return `world-${crypto.createHash("sha256").update(url).digest("hex").slice(0, 20)}`;
}

function teamHint(title) {
  const rules = [
    ["Galatasaray", /galatasaray/i],
    ["Fenerbahçe", /fenerbah/i],
    ["Beşiktaş", /be[sş]ikta[sş]/i],
    ["Trabzonspor", /trabzonspor/i],
    ["Real Madrid", /real madrid/i],
    ["Barcelona", /barcelona/i],
    ["Manchester City", /manchester city|man city/i],
    ["Manchester United", /manchester united|man united|man utd/i],
    ["Arsenal", /arsenal/i],
    ["Chelsea", /chelsea/i],
    ["Liverpool", /liverpool/i]
  ];
  const found = rules.find(([, pattern]) => pattern.test(title));
  return found ? found[0] : "";
}

/**
 * RSS öğelerini bant kaydına çevirir. Kaynaksız, listedeki alanı
 * taşımayan, kapsam dışı ve 48 saatten eski başlıklar düşer.
 */
export async function buildWorldItems(entries, options = {}) {
  const nowMs = options.nowMs || Date.now();
  const translate = options.translate || translateHeadline;
  const accepted = [];
  const rejected = [];
  const seen = new Set();

  for (const entry of entries || []) {
    const title = usableTitle(entry && entry.title);
    const url = canonicalArticleUrl(entry && entry.link);
    const published = Date.parse(entry && entry.publishedAt);
    const feed = entry && entry.feed || {};
    if (!title || !url || Number.isNaN(published)) {
      rejected.push({ title, reason: "başlık, kaynak adresi veya tarih eksik" });
      continue;
    }
    if (published > nowMs + 15 * 60 * 1000 || nowMs - published > FRESHNESS_MS) {
      rejected.push({ title, reason: "tazelik penceresi dışında" });
      continue;
    }
    if (!isAllowedSourceUrl(url)) {
      rejected.push({ title, url, reason: "kaynak alanı beyaz listede değil" });
      continue;
    }
    if (!inWorldScope(title)) {
      rejected.push({ title, reason: "büyük turnuva, büyük kulüp veya Süper Lig kapsamı dışında" });
      continue;
    }
    const key = url.replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);

    const kind = classifyHeadline(title);
    const sourceLang = feed.lang || "en";
    let turkish = null;
    let english = sourceLang === "en" ? title : null;
    if (options.translateEnabled !== false) {
      turkish = await translate(title, sourceLang, "tr", options);
      if (sourceLang !== "en") english = await translate(title, sourceLang, "en", options);
    }
    if (kind.confidence === "claim" && turkish && contradictsClaim(turkish)) turkish = null;
    const text = hedgeText(turkish || title, kind.confidence === "claim");
    if (!text || (kind.confidence === "claim" && contradictsClaim(text))) {
      rejected.push({ title, reason: "iddia metni kesinlik fiili taşıyor" });
      continue;
    }
    const item = {
      id: worldId(key),
      origin: WORLD_ORIGIN,
      category: kind.category,
      confidence: kind.confidence,
      text,
      textLang: turkish ? "tr" : sourceLang,
      timestamp: new Date(published).toISOString(),
      source: { name: feed.name || entry.sourceName || "Kaynak", url }
    };
    const team = teamHint(title);
    if (team) item.team = team;
    if (english) {
      item.en = { text: kind.confidence === "claim" && !/claim|reportedly|want|offer|linked|talks/i.test(english) ? `Claim: ${english}` : english };
    }
    const verdict = validateTickerItem(item);
    if (!verdict.valid) {
      rejected.push({ title, reason: verdict.errors.join("; ") });
      continue;
    }
    accepted.push({ item, feedId: feed.id || "", at: published });
  }

  const perFeed = new Map();
  const items = accepted
    .sort((left, right) => right.at - left.at)
    .filter((row) => {
      const used = perFeed.get(row.feedId) || 0;
      if (used >= PER_FEED) return false;
      perFeed.set(row.feedId, used + 1);
      return true;
    })
    .slice(0, MAX_STORED)
    .map((row) => row.item);

  return { items, rejected };
}

export function mergeWorldItems(previous, incoming) {
  const existing = Array.isArray(previous && previous.items) ? previous.items : [];
  const kept = existing.filter((item) => item && item.origin !== WORLD_ORIGIN && !String(item && item.id || "").startsWith("world-"));
  return {
    ...(previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {}),
    items: [...kept, ...(incoming || [])]
  };
}

const FINISHED = new Set(["FINISHED", "FT", "AET", "PEN"]);
const LIVE = new Set(["LIVE", "IN_PLAY", "1H", "2H", "HT", "HALFTIME", "ET"]);
const MAJOR_LEAGUE = /champions|europa|conference|premier|la liga|laliga|serie a|bundesliga|ligue 1|s[uü]per lig|super lig|world cup|d[uü]nya kupas|nations league|uluslar/i;

export function isApiFootballMatch(match) {
  const provider = `${match && match.source || ""} ${match && match.providerName || ""} ${match && match.provider || ""}`.toLowerCase();
  if (provider.includes("thesportsdb")) return false;
  return provider.includes("api-football") || provider.includes("api-sports");
}

/** API-Football önbelleğindeki canlı veya son 48 saatte bitmiş skorlar. */
export function apiFootballScoreItems(matches, options = {}) {
  const nowMs = options.nowMs || Date.now();
  const locale = options.locale === "en" ? "en" : "tr";
  const rows = [];
  for (const match of Array.isArray(matches) ? matches : []) {
    if (!isApiFootballMatch(match)) continue;
    const home = String(match.homeTeam || "").trim();
    const away = String(match.awayTeam || "").trim();
    const score = match.score || {};
    if (!home || !away || score.home === null || score.home === undefined || score.away === null || score.away === undefined) continue;
    if (!Number.isFinite(Number(score.home)) || !Number.isFinite(Number(score.away))) continue;
    const league = `${match.league || ""} ${match.competitionId || ""}`;
    if (!MAJOR_LEAGUE.test(league)) continue;
    const status = String(match.status || match.providerStatus || "").toUpperCase();
    const kickoff = Date.parse(match.kickoff || match.fetchedAt || "");
    if (Number.isNaN(kickoff)) continue;
    const age = nowMs - kickoff;
    const live = LIVE.has(status) || match.live === true;
    const finished = FINISHED.has(status);
    if (live && (age < 0 || age > 3 * 60 * 60 * 1000)) continue;
    if (!live && !(finished && age >= 0 && age <= FRESHNESS_MS)) continue;
    const id = String(match.id || match.providerId || `${home}-${away}`);
    rows.push({
      id: `score-${id}`,
      label: live ? (locale === "en" ? "Live" : "Canlı") : (locale === "en" ? "Full time" : "Sonuç"),
      text: `${home} ${Number(score.home)}-${Number(score.away)} ${away}`,
      href: locale === "en" ? `en/live-football-scores.html#${id}` : `canli-skor.html#${id}`,
      at: new Date(kickoff).toISOString(),
      source: "match",
      sourceName: "API-Football",
      provider: "api-football",
      priority: (live ? 0.2 : 1.02)
    });
  }
  const seen = new Set();
  return rows
    .sort((left, right) => left.priority - right.priority || right.at.localeCompare(left.at))
    .filter((row) => {
      const key = row.text.toLocaleLowerCase("tr");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 2);
}
