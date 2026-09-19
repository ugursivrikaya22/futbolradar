#!/usr/bin/env node
/**
 * İNGİLİZCE HABER AKIŞINI TAZELER — `data/news-en.json`.
 *
 * Türkçe akışın (`sync-football-news.mjs`) İNGİLİZCE KARDEŞİ, kopyası
 * değil. İkisi ayrı beslemelerden beslenir ve ayrı dosyalara yazar;
 * aralarında veri akışı YOKTUR. Bu bilerek böyle: tek bir ortak havuz
 * olsaydı Türkçe bir kayıt er geç İngilizce sayfaya düşerdi — zaten
 * olan da buydu.
 *
 * Metin çevrilmez. `services/englishNews.js` İngilizce kaynaktan
 * İngilizce cümle üretir; kaynağın cümlesi kopyalanmaz, künyesi
 * korunur.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { parseRss } from "./sync-football-news.mjs";

const require = createRequire(import.meta.url);
const {
  ENGLISH_FEEDS,
  buildEnglishArticle,
  isPublishableEnglish,
  isStillAcceptable,
  jaccard,
  rankEnglishNews,
  withUniqueEnglishMetadata
} = require("../services/englishNews.js");

const ROOT = process.cwd();
const TARGET = path.join(ROOT, "data", "news-en.json");

const REQUEST_TIMEOUT_MS = 12000;
const REQUEST_RETRIES = 2;
/** Besleme başına alınacak en fazla kayıt — tek kaynak akışı ele geçirmesin. */
const PER_FEED_INTAKE = 12;
/** Dosyada tutulacak en fazla haber. Eskiler düşer, arşiv şişmez. */
const MAX_ARTICLES = 400;
/**
 * İki haber ne kadar benzerse aynı hikâyedir. Aynı olayı üç ajans
 * verdiğinde /en akışında üç kart görünmesin diye.
 */
const DUPLICATE_THRESHOLD = 0.72;

async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= REQUEST_RETRIES + 1; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
          /*
           * KİMLİK BİLDİRMEK ŞART. Guardian besleme isteğini kimliksiz
           * geldiği için 403 ile geri çeviriyordu. Kendimizi tanıtıyoruz
           * ve iletişim adresi bırakıyoruz — yayıncı kim çektiğini görsün,
           * gerekirse sınırlasın.
           */
          "user-agent": "Mozilla/5.0 (compatible; FutbolRadarBot/1.0; +https://www.futbolradar.com)"
        }
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

function readExisting() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TARGET, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Geçici dosyaya yazıp yerine taşır — yarım dosya yayına çıkmasın. */
function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

/**
 * AYNI HİKÂYE TEK KAYIT.
 *
 * Önce kimlik (slug) sonra başlık benzerliği. Var olan kayıt KORUNUR;
 * yeni gelen yalnızca daha güçlü bir durum taşıyorsa (resmî) günceller.
 * Böylece bir haberin adresi, durumu ilerlese bile değişmez.
 */
export function mergeEnglishNews(existing, incoming) {
  const merged = [...existing];
  const bySlug = new Map(merged.map((article, index) => [article.slug, index]));
  let added = 0;
  let updated = 0;

  for (const candidate of incoming) {
    const knownIndex = bySlug.get(candidate.slug);
    if (knownIndex !== undefined) {
      const known = merged[knownIndex];
      // Resmî duyuru bir aktarımın yerine geçer; tersi olmaz.
      if (candidate.editorialStatus === "official" && known.editorialStatus !== "official") {
        merged[knownIndex] = { ...known, ...candidate, updatedAt: new Date().toISOString() };
        updated += 1;
      }
      continue;
    }

    const duplicate = merged.some(
      (article) =>
        article.competition === candidate.competition &&
        jaccard(article.title, candidate.title) >= DUPLICATE_THRESHOLD
    );
    if (duplicate) continue;

    merged.push(candidate);
    bySlug.set(candidate.slug, merged.length - 1);
    added += 1;
  }

  return { articles: merged, added, updated };
}

export async function synchronizeEnglishNews(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const feeds = options.feeds || ENGLISH_FEEDS;
  const read = options.fetchText || fetchText;
  /*
   * ESKİ KAYITLAR DA GÜNCEL KURALLARDAN GEÇER.
   *
   * Dosyayı olduğu gibi devralmak, bir kural sıkılaştırıldığında geçmişi
   * dokunulmaz kılıyordu; düzeltme yalnızca yeni kayıtlara işliyordu.
   * Süzgeç burada, birleştirmeden ÖNCE çalışır.
   */
  const stored = options.existing || readExisting();
  const existing = stored.filter(isStillAcceptable);
  const purged = stored.length - existing.length;

  const candidates = [];
  const failures = [];

  for (const feed of feeds) {
    try {
      const xml = await read(feed.url, feed);
      const items = parseRss(xml, feed).slice(0, PER_FEED_INTAKE);
      for (const item of items) {
        const article = buildEnglishArticle({ item, feed, now });
        // Süzgeç ÜRETİMDEN SONRA çalışır: kaynak başlığı İngilizce olsa da
        // üretilen metnin İngilizce olduğu ayrıca doğrulanır.
        if (article && isPublishableEnglish(article)) candidates.push(article);
      }
    } catch (error) {
      // Tek beslemenin düşmesi akışı durdurmaz; hangi beslemenin
      // düştüğü raporda görünür ki sessizce kör kalmayalım.
      failures.push({ feed: feed.id, error: String((error && error.message) || error) });
    }
  }

  const { articles, added, updated } = mergeEnglishNews(existing, candidates);
  // Kayıt DOSYAYA yazılırken benzersizleştirilir: sayfayı çizen taraf da
  // aynı kuralı uygular ama akıştan sonra çalışan başka adımlar (paylaşılan
  // düzen, meta normalleştirme) metni doğrudan bu dosyadan okuyor.
  const ranked = withUniqueEnglishMetadata(
    rankEnglishNews(articles, { now: now.getTime() }).slice(0, MAX_ARTICLES)
  );

  if (!options.dryRun) atomicWrite(TARGET, ranked);

  return {
    total: ranked.length,
    added,
    updated,
    purged,
    fetched: candidates.length,
    failures,
    feeds: feeds.length
  };
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("sync-english-news.mjs");
if (invokedDirectly) {
  const report = await synchronizeEnglishNews({ dryRun: process.argv.includes("--dry-run") });
  console.log(
    `english-news: ${report.total} kayıt (${report.added} yeni, ${report.updated} güncellendi` +
      `${report.purged ? `, ${report.purged} kural dışı kalarak düştü` : ""}) — ` +
      `${report.feeds} beslemeden ${report.fetched} aday`
  );
  for (const failure of report.failures) {
    console.warn(`  besleme düştü: ${failure.feed} — ${failure.error}`);
  }
  // Beslemelerin TAMAMI düşerse bu bir ağ/şema arızasıdır, sessiz geçilmez.
  if (report.failures.length === report.feeds) {
    console.error("english-news: hiçbir besleme okunamadı");
    process.exitCode = 1;
  }
}
