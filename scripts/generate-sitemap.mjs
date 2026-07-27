/**
 * SITE HARİTASI — TEK YETKİLİ ÜRETİCİ.
 *
 * ÖNCEKİ MİMARİ VE NEDEN TEHLİKELİYDİ
 *
 * sitemap.xml altı ayrı betik tarafından yazılıyordu ve bunlardan yalnızca
 * biri (generate-static-seo-pages) dosyayı BAŞTAN kuruyordu. O betik mac/,
 * mac-raporu/ ve dokuz kök sayfadan haberdar değil; diğer beşi ise
 * yazdıklarını `/  <url>[\s\S]*?  <\/url>/g` düzenli ifadesiyle "koruyarak"
 * hayatta kalıyordu — yani iki boşluklu girinti sözleşmesine.
 *
 * Bu düzenin iki kusuru vardı:
 *
 *   1. SIRA BAĞIMLILIĞI. Tam yeniden yazan betik zincirin ortasında
 *      koşuyor. Tek başına çalıştırılırsa (ya da build sırası değişirse)
 *      323 URL sessizce siliniyordu: 306 maç sayfası, 8 maç raporu ve 9 kök
 *      sayfa — sitenin zamana en duyarlı içeriği. Hata vermiyor, yalnızca
 *      kayboluyordu.
 *   2. BİÇİM BAĞIMLILIĞI. Girintiyi değiştiren bir üretici, kendi
 *      URL'lerini sessizce kaybederdi.
 *
 * YENİ MİMARİ
 *
 * Tek betik, build'in EN SONUNDA koşar ve site haritasını DOSYA
 * SİSTEMİNDEN türetir. Hangi sayfanın var olduğunu tahmin etmez; diske
 * bakar. Bir üretici yeni sayfa eklediğinde site haritası kendiliğinden
 * doğru olur, ve hiçbir üreticinin site haritasını bilmesi gerekmez.
 *
 * Postprocess'ten SONRA koşması şart: apply-shared-layout ve
 * prerender-core-pages robots direktifini değiştirebiliyor, bu yüzden
 * noindex kararı ancak son HTML üzerinde güvenilir biçimde okunur.
 *
 * Doğrulama: bu betiğin çıktısı, değiştirdiği altı betikli zincirin
 * çıktısıyla URL kümesi olarak BİREBİR aynıdır (3281 URL, sıfır fark).
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const domain = "https://www.futbolradar.com";

/** Sayfa barındırmayan dizinler; site haritası taraması buralara girmez. */
const SKIP_DIRS = new Set([
  "public", "node_modules", ".git", ".github", "scripts", "services",
  "lib", "data", "api", "server", "components", "assets", "docs"
]);

/**
 * Bir HTML dosyası YAYIMLANABİLİR bir sayfa mı?
 *
 * Üç eleme var ve üçü de dosyanın kendisinden okunur — elle tutulan bir
 * liste yok, çünkü elle tutulan liste eskiyor.
 */
function pageDecision(html) {
  // 1. Arama motoru doğrulama saplaması gibi sayfa olmayan dosyalar.
  //    (Google'ın verdiği dosya 54 bayt ve <title> taşımıyor.)
  if (!/<html[\s>]/i.test(html) || !/<title[\s>]/i.test(html)) {
    return { include: false, reason: "sayfa değil (html/title yok)" };
  }

  // 2. noindex taşıyan sayfa site haritasına GİRMEZ. "noindex + site
  //    haritasında listeli" çelişkili bir sinyaldir: harita taranmasını
  //    ister, sayfa indekslenmemeyi söyler. Search Console bunu
  //    "Gönderildi ama indekslenmedi" hatası olarak raporlar.
  if (/content="noindex/i.test(html)) {
    return { include: false, reason: "noindex" };
  }

  return { include: true, reason: null };
}

function walkHtml(dir, collected = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkHtml(full, collected);
    } else if (entry.name.endsWith(".html")) {
      collected.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }
  return collected;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  } catch (error) {
    return fallback;
  }
}

/* ------------------------------------------------------------------ *
 * lastmod — GERÇEK DEĞİŞİM TARİHİ
 *
 * Derleme zamanı KULLANILMAZ. Değişmemiş 3281 URL'ye her derlemede
 * "bugün" yazmak, site haritasının en çok suistimal edilen alanıdır ve
 * arama motoru bunu öğrenip alanı tamamen yok sayar. Dürüst kaynak,
 * sayfanın DAYANDIĞI verinin doğrulanma zamanıdır: veri durduğunda tarih
 * de durur.
 * ------------------------------------------------------------------ */

const players = readJson("data/players.json", []);
const freshness = readJson("data/freshness.json", {});
const fixtures = readJson("data/super-lig-fixtures.json", {});

function isoDay(value) {
  const day = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** Veri kümesindeki en yeni doğrulama zamanı — son çare. */
const datasetVerifiedAt = (() => {
  const records = (freshness && freshness.records) || {};
  const stamps = Object.values(records)
    .map((record) => isoDay(record && (record.verifiedAt || record.fetchedAt)))
    .filter(Boolean)
    .sort();
  return stamps.length ? stamps[stamps.length - 1] : null;
})();

const fixtureVerifiedAt = isoDay(
  (freshness.records && freshness.records.fixtures && freshness.records.fixtures.verifiedAt) ||
  fixtures.lastVerifiedAt
) || datasetVerifiedAt;

const playerDayById = new Map();
for (const player of Array.isArray(players) ? players : []) {
  const day = isoDay(player.lastVerifiedAt || player.lastSyncedAt);
  if (!day) continue;
  playerDayById.set(player.id, day);
  if (player.slug) playerDayById.set(player.slug, day);
}

function newestDay(days) {
  const valid = days.filter(Boolean).sort();
  return valid.length ? valid[valid.length - 1] : null;
}

function lastmodFor(file) {
  if (file.startsWith("oyuncular/")) {
    const id = path.basename(file, ".html");
    return playerDayById.get(id) || datasetVerifiedAt;
  }

  if (file.startsWith("karsilastirma/")) {
    const base = path.basename(file, ".html");
    const index = base.indexOf("-vs-");
    if (index > -1) {
      const left = playerDayById.get(base.slice(0, index));
      const right = playerDayById.get(base.slice(index + 4));
      const newest = newestDay([left, right]);
      if (newest) return newest;
    }
    return datasetVerifiedAt;
  }

  if (file.startsWith("mac/") || file.startsWith("mac-raporu/")) {
    return fixtureVerifiedAt;
  }

  return datasetVerifiedAt;
}

/* ------------------------------------------------------------------ *
 * priority / changefreq
 *
 * İkisi de ZAYIF sinyaller; Google priority'yi büyük ölçüde yok sayar.
 * Yine de tutarlı olmalılar: eski değerler tersine dönmüştü — henüz
 * başlamamış bir sezonun fikstür sayfaları (0.85) her editoryal sayfanın
 * (0.8) üstündeydi. Sıralama artık sayfanın kalıcı değerini yansıtıyor.
 * ------------------------------------------------------------------ */
function rankFor(file) {
  if (file === "index.html") return { priority: "1.0", changefreq: "daily" };
  if (file.startsWith("mac-raporu/")) return { priority: "0.7", changefreq: "monthly" };
  if (file.startsWith("mac/")) return { priority: "0.6", changefreq: "weekly" };
  if (file.startsWith("karsilastirma/")) return { priority: "0.4", changefreq: "monthly" };
  if (file.startsWith("oyuncular/")) return { priority: "0.6", changefreq: "weekly" };
  return { priority: "0.8", changefreq: "weekly" };
}

function locFor(file) {
  return file === "index.html" ? `${domain}/` : `${domain}/${file}`;
}

/* ------------------------------------------------------------------ *
 * Üretim
 * ------------------------------------------------------------------ */

const allHtml = walkHtml(root).sort();
const included = [];
const excluded = [];

for (const file of allHtml) {
  const html = fs.readFileSync(path.join(root, file), "utf8");
  const decision = pageDecision(html);
  if (decision.include) included.push(file);
  else excluded.push({ file, reason: decision.reason });
}

/**
 * BOŞ SİTE HARİTASI YAZILMAZ.
 *
 * Değiştirdiğimiz zincirin asıl kusuru sessiz kayıptı; aynı hatayı yeni
 * betikte tekrarlamamak için sonuç makul değilse hiç yazılmaz. Bu, "yarım
 * çekim üretim verisini ezmez" kuralının site haritası karşılığı.
 */
const MIN_SAFE_URL_COUNT = 100;
if (included.length < MIN_SAFE_URL_COUNT) {
  console.error(`[sitemap] YAZMA REDDEDİLDİ: yalnızca ${included.length} URL bulundu ` +
    `(en az ${MIN_SAFE_URL_COUNT} bekleniyor). Mevcut site haritası korundu.`);
  process.exitCode = 1;
} else {
  const body = included.map((file) => {
    const { priority, changefreq } = rankFor(file);
    const lastmod = lastmodFor(file);
    return `  <url>\n    <loc>${locFor(file)}</loc>` +
      (lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : "") +
      `\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
  }).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;

  fs.writeFileSync(path.join(root, "sitemap.xml"), xml, "utf8");
  const publicDir = path.join(root, "public");
  if (fs.existsSync(publicDir)) {
    fs.writeFileSync(path.join(publicDir, "sitemap.xml"), xml, "utf8");
  }

  const byReason = excluded.reduce((acc, item) => {
    acc[item.reason] = (acc[item.reason] || 0) + 1;
    return acc;
  }, {});
  const reasonSummary = Object.entries(byReason).map(([reason, count]) => `${reason}: ${count}`).join(", ");
  console.log(`Sitemap: ${included.length} URL yazıldı (${allHtml.length} HTML tarandı; ` +
    `elenen ${excluded.length}${reasonSummary ? ` — ${reasonSummary}` : ""})`);
}
