#!/usr/bin/env node
/**
 * SPORX KEŞİF HATTI — ANA ÇALIŞTIRICI.
 *
 * GÖREV. GitHub Actions'ta 15 dakikada bir çalışır (bkz.
 * .github/workflows/sporx-news-discovery.yml). Her koşuda:
 *
 *   1. Sporx'in futbol anasayfasını KEŞİF için tarar (scripts/lib/sporxFeed.mjs).
 *   2. Daha önce işlenmiş adresleri (`data/sporx-seen.json`) ve
 *      `data/news.json`'daki mevcut haberleri eler — AYNI HABER İKİ KEZ
 *      YAYIMLANMAZ.
 *   3. Kapsam dışı adayları eler (görev tanımındaki sekiz öncelik
 *      kategorisinden birine girmeyen her şey — bkz. services/sporxNews.js).
 *   4. Kalan adaylardan, öncelik sırasına göre en fazla `--limit` (varsayılan
 *      6) tanesi için ÖZGÜN bir FutbolRadar haberi üretir — Sporx'in
 *      başlığı/metni/görseli KOPYALANMAZ, yalnızca olay çıkarılır.
 *   5. `data/news.json`'a ekler, `data/sporx-seen.json`'ı günceller.
 *
 * NE YAPMAZ. Sayfa üretmez, bandı tazelemez, commit atmaz — bunlar için
 * ayrı, zaten var olan ve test edilmiş betikler kullanılır
 * (generate-news-pages.mjs, prerender-core-pages.mjs, postprocess.mjs,
 * ci-commit-push.mjs). Tek iş burada: KEŞİF + ÖZGÜN YAZIM + KAYIT.
 *
 * Kullanım:
 *   node scripts/discover-sporx-news.mjs                (kuru koşu, yazmaz)
 *   node scripts/discover-sporx-news.mjs --apply
 *   node scripts/discover-sporx-news.mjs --apply --limit=4
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { readJsonFile } from "./lib/readJsonFile.mjs";
import { fetchSporxCandidates, fetchArticlePublishedAt } from "./lib/sporxFeed.mjs";

const require = createRequire(import.meta.url);
const { classifyCandidate, buildArticle, jaccard } = require("../services/sporxNews.js");
const { asList } = require("../services/newsFeed.js");

const root = process.cwd();
const NEWS_PATH = path.join(root, "data", "news.json");
const SEEN_PATH = path.join(root, "data", "sporx-seen.json");
const TRANSFERS_PATH = path.join(root, "data", "transfers.json");

const apply = process.argv.includes("--apply");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const LIMIT = limitArg ? Math.max(1, Number(limitArg.split("=")[1]) || 6) : 6;

/** Bir kaydın aynı haberi anlatıp anlatmadığını, aşırı benzerlik yerine ORTAK ANLAM üzerinden yoklar. */
const DUPLICATE_THRESHOLD = 0.45;

/** İşlenmiş Sporx adreslerinin ne kadar süre saklanacağı — dosyanın sınırsız büyümesini önler. */
const SEEN_RETENTION_DAYS = 30;

function log(line) {
  console.log(`[sporx-discovery] ${line}`);
}

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function loadNews() {
  const payload = readJsonFile(NEWS_PATH, []);
  return asList(payload);
}

function loadSeen() {
  const payload = readJsonFile(SEEN_PATH, { processed: [] });
  return Array.isArray(payload.processed) ? payload.processed : [];
}

function pruneSeen(entries, now) {
  const cutoff = now.getTime() - SEEN_RETENTION_DAYS * 24 * 3600000;
  return entries.filter((entry) => {
    const at = Date.parse(entry && entry.at);
    return Number.isFinite(at) && at >= cutoff;
  });
}

/** Bu Sporx başlığı `data/news.json`'daki mevcut bir haberle aynı olayı mı anlatıyor? */
function isDuplicateOfExistingNews(candidate, existingNews) {
  const candidateText = `${candidate.title} ${candidate.summary || ""}`;
  return existingNews.some((entry) => {
    const alreadySourced = Array.isArray(entry.sources) && entry.sources.some((source) => text(source && source.url) === candidate.url);
    if (alreadySourced) return true;

    const entryText = `${text(entry.title)} ${text(entry.summary)}`;
    return jaccard(candidateText, entryText) >= DUPLICATE_THRESHOLD;
  });
}

async function main() {
  const now = new Date();
  const news = loadNews();
  const seen = loadSeen();
  const seenUrls = new Set(seen.map((entry) => entry.url));
  const transfers = readJsonFile(TRANSFERS_PATH, []);
  const transferRows = Array.isArray(transfers) ? transfers : (Array.isArray(transfers.transfers) ? transfers.transfers : []);

  log(`Sporx futbol anasayfası taranıyor...`);
  const candidates = await fetchSporxCandidates();
  log(`${candidates.length} aday bulundu.`);

  const fresh = candidates.filter((candidate) => !seenUrls.has(candidate.url));
  log(`${fresh.length} aday daha önce işlenmemiş.`);

  const scoped = [];
  for (const candidate of fresh) {
    const classification = classifyCandidate(candidate);
    if (!classification) continue;
    if (isDuplicateOfExistingNews(candidate, news)) {
      log(`atlandı (zaten yayımlanmış olayla örtüşüyor): ${candidate.title}`);
      continue;
    }
    scoped.push({ candidate, classification });
  }

  scoped.sort((a, b) => a.classification.rank - b.classification.rank);
  const batch = scoped.slice(0, LIMIT);
  log(`${scoped.length} aday kapsam içi; bu koşuda ${batch.length} tanesi işlenecek.`);

  // Şablonlar oyuncu adı çıkarılamadığında ("statement"/"squad" gibi genel
  // olaylarda) sabit, takıma özgü bir başlığa düşer — aynı takım için ard
  // arda birden fazla haber aynı Sporx sayfasına göre AYNI başlığı üretebilir.
  // qa.mjs her başlığın SEO için biricik olmasını şart koşar; bu yüzden
  // burada, `data/news.json`'a yazmadan önce üretilen başlığın hem mevcut
  // hem de bu koşudaki diğer haberlerle çakışmadığından emin olunur.
  const usedTitles = new Set(
    news
      .filter((entry) => entry && String(entry.status || "").toLowerCase() === "verified")
      .map((entry) => text(entry.title))
  );

  const newArticles = [];
  const newlySeen = [];

  for (const { candidate, classification } of batch) {
    const publishedAt = await fetchArticlePublishedAt(candidate.url) || now.toISOString();
    const article = buildArticle({
      candidate: { ...candidate, publishedAt },
      classification,
      transfers: transferRows,
      now
    });

    if (usedTitles.has(article.title)) {
      log(`atlandı (başlık çakışması — özgünleştirecek ayırt edici bilgi yok): ${article.title}`);
      newlySeen.push({ url: candidate.url, at: now.toISOString(), slug: article.slug });
      continue;
    }

    usedTitles.add(article.title);
    newArticles.push(article);
    newlySeen.push({ url: candidate.url, at: now.toISOString(), slug: article.slug });
    log(`özgün haber üretildi [${classification.category}]: "${article.title}" (kaynak: ${candidate.url})`);
  }

  if (!apply) {
    log(`kuru koşu — ${newArticles.length} yeni haber yazılmadı. --apply ile gerçek yazım yapılır.`);
    return;
  }

  if (!newlySeen.length) {
    log("yeni haber yok, dosyalar değişmedi.");
    return;
  }

  if (!newArticles.length) {
    const updatedSeen = pruneSeen([...seen, ...newlySeen], now);
    fs.writeFileSync(SEEN_PATH, `${JSON.stringify({ processed: updatedSeen }, null, 2)}\n`, "utf8");
    log(`yeni haber yok (hepsi başlık çakışması nedeniyle atlandı); data/sporx-seen.json güncellendi (${updatedSeen.length} kayıt).`);
    return;
  }

  const updatedNews = [...newArticles, ...news];
  fs.writeFileSync(NEWS_PATH, `${JSON.stringify(updatedNews, null, 2)}\n`, "utf8");

  const updatedSeen = pruneSeen([...seen, ...newlySeen], now);
  fs.writeFileSync(SEEN_PATH, `${JSON.stringify({ processed: updatedSeen }, null, 2)}\n`, "utf8");

  log(`${newArticles.length} yeni haber data/news.json'a eklendi; data/sporx-seen.json güncellendi (${updatedSeen.length} kayıt).`);
}

main().catch((error) => {
  console.error(`[sporx-discovery] beklenmeyen hata: ${error && error.stack ? error.stack : error}`);
  process.exitCode = 1;
});
