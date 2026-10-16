#!/usr/bin/env node
/**
 * AYNI ADLI LİGLERİ AYIR — MEVCUT VERİYİ ONAR (EMİR 1B, Görev 3).
 *
 * Sorun: sağlayıcıdan "Ligue 1" adıyla gelen Cezayir (186), Tunus (202),
 * Fildişi Sahili (386) ve Senegal (403) ligleri, ad eşleşmesi yüzünden
 * Fransa Ligue 1'i (61) olarak `competitionId: "ligue-1"` ile kaydedilmişti.
 * Aynı hata "Premier League", "Primera División", "Championship" ve
 * "Bundesliga" adlarında da vardı (toplam 227 takvim satırı).
 * Sonuç: Cezayir maç sayfaları Fransa Ligue 1 puan durumuna bağlanıyor,
 * büyük beş lig önceliğiyle sıralanıyordu.
 *
 * Bu betik YENİ kuralı (services/competitionCatalog.js: sağlayıcı lig kimliği
 * adı ezer) mevcut dosyalara uygular. Yeni gelen veri zaten
 * scripts/sync-live-fixtures.mjs üzerinden doğru kimlikle yazılıyor.
 *
 * Yaptıkları:
 *   1. data/fixture-calendar.json (+ public/data): competitionId ve lig adı.
 *   2. data/fixture-predictions.json: competitionId (takvimle aynı değer).
 *   3. Arşivler (historical-match-archive, season-archive, post-match-reports):
 *      yalnızca takvimde YABANCI olarak işaretlenmiş maçın lig adı.
 *   4. data/match-seo-pages.json: yabancı maçın sayfası sicilden düşer, sayfa
 *      dosyaları silinir, eski adres vercel.json'da maç merkezine 301'lenir.
 *      Silinenlerin dökümü data/league-identity-report.json'a yazılır.
 *
 *   node scripts/repair-league-identity.mjs            # yalnızca raporlar
 *   node scripts/repair-league-identity.mjs --apply    # yazar
 *
 * Idempotent: ikinci koşuda değişiklik yoktur.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isForeignNamesake, qualifiedLeagueName, separateCompetitionId, normalizeKey } = require("../services/competitionCatalog.js");

const root = process.cwd();
const apply = process.argv.includes("--apply");
const dataPath = (name) => path.join(root, "data", name);
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (file, value) => {
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
};

// ── 1. Takvim ─────────────────────────────────────────────────────────────
const calendarFile = dataPath("fixture-calendar.json");
const calendar = read(calendarFile);
const foreignById = new Map();      // takvim kimliği → { league, competitionId, plainLeague }
const foreignByProviderId = new Map(); // sağlayıcı fikstür kimliği → competitionId
const foreignIdentities = new Set(); // "ev|dep|gün" — sicil/arşiv eşleştirmesi için
let calendarChanged = 0;

const dayOf = (value) => String(value || "").slice(0, 10);
const identityOf = (home, away, kickoff) => `${normalizeKey(home)}|${normalizeKey(away)}|${dayOf(kickoff)}`;

for (const match of calendar.matches || []) {
  const alreadyQualified = / \([^)]+\)$/.test(String(match.league || ""));
  // Daha önce onarılmış satır: ad ülkeli, kimlik ayrı. Yine de haritaya girer.
  const stored = String(match.competitionId || "");
  const foreign = isForeignNamesake({ ...match, league: match.league.replace(/ \([^)]+\)$/, "") }, normalizeKey(stored))
    || (alreadyQualified && /-\d+$/.test(stored));
  if (!foreign) continue;

  const plain = String(match.league || "").replace(/ \([^)]+\)$/, "");
  const base = { ...match, league: plain };
  const next = {
    competitionId: /-\d+$/.test(stored) && alreadyQualified ? stored : separateCompetitionId({ ...base, competitionId: stored }),
    league: alreadyQualified ? match.league : qualifiedLeagueName({ ...base, competitionId: stored })
  };
  foreignById.set(match.id, { ...next, plainLeague: plain });
  if (match.providerId) foreignByProviderId.set(String(match.providerId), next.competitionId);
  foreignIdentities.add(identityOf(match.homeTeam, match.awayTeam, match.kickoff));
  if (match.competitionId !== next.competitionId || match.league !== next.league) {
    match.competitionId = next.competitionId;
    match.league = next.league;
    calendarChanged += 1;
  }
}

// ── 2. Tahminler ──────────────────────────────────────────────────────────
const predictionsFile = dataPath("fixture-predictions.json");
const predictions = fs.existsSync(predictionsFile) ? read(predictionsFile) : null;
let predictionsChanged = 0;
if (predictions) {
  for (const prediction of predictions.predictions || []) {
    let target = foreignByProviderId.get(String(prediction.providerFixtureId || ""));
    if (!target && prediction.leagueId !== undefined && prediction.leagueId !== null && /^[a-z0-9-]+$/.test(String(prediction.competitionId || ""))) {
      // Takvimde artık olmayan eski tahmin: kimlik çakışıyorsa aynı ayrım kuralı.
      const probe = { league: prediction.competitionId, competitionId: prediction.competitionId, providerLeagueId: prediction.leagueId };
      if (isForeignNamesake(probe, normalizeKey(prediction.competitionId))) target = separateCompetitionId(probe);
    }
    if (target && prediction.competitionId !== target) {
      prediction.competitionId = target;
      predictionsChanged += 1;
    }
  }
}

// ── 3. Arşivler ───────────────────────────────────────────────────────────
function repairArchiveLeague(record, { idKey, holder }) {
  const target = holder(record);
  if (!target) return 0;
  const info = foreignById.get(target[idKey]);
  if (!info) return 0;
  let changed = 0;
  for (const field of ["league", "competition"]) {
    if (target[field] === info.plainLeague && info.league !== info.plainLeague) {
      target[field] = info.league;
      changed += 1;
    }
  }
  return changed;
}

const archiveFiles = {
  history: dataPath("historical-match-archive.json"),
  season: dataPath("season-archive.json"),
  reports: dataPath("post-match-reports.json")
};
const archives = Object.fromEntries(Object.entries(archiveFiles).map(([key, file]) => [key, fs.existsSync(file) ? read(file) : null]));
let archiveChanged = 0;
if (archives.history) for (const record of archives.history.records || []) archiveChanged += repairArchiveLeague(record, { idKey: "id", holder: (r) => r.match });
if (archives.season) {
  for (const season of Object.values(archives.season.seasons || {})) {
    for (const match of season.matches || []) archiveChanged += repairArchiveLeague(match, { idKey: "id", holder: (r) => r });
  }
}
if (archives.reports) for (const record of archives.reports.records || []) archiveChanged += repairArchiveLeague(record, { idKey: "matchId", holder: (r) => r });

// ── 4. Maç SEO sicili ─────────────────────────────────────────────────────
const registryFile = dataPath("match-seo-pages.json");
const registry = fs.existsSync(registryFile) ? read(registryFile) : { pages: [] };
const removed = [];
const kept = [];
const { competitions: catalog } = require("../services/competitionCatalog.js");
const standingsFile = dataPath("league-standings.json");
const standings = fs.existsSync(standingsFile) ? read(standingsFile) : {};
const teamKey = (name) => String(name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
// Tablo kuralı YALNIZCA adı birden çok ülkede kullanılan liglere uygulanır.
// Süper Lig gibi liglerde kulüp adı yazımı tabloyla birebir tutmayabilir
// (Gençlerbirliği / Genclerbirligi SK); yanlış silmek yanlış etiketten kötüdür.
const NAMESAKE_PRONE = new Set(["ligue-1", "premier-league", "la-liga", "bundesliga", "serie-a", "championship"]);
const domesticIds = new Set(catalog.filter((entry) => entry.type === "domestic" && NAMESAKE_PRONE.has(entry.id)).map((entry) => entry.id));
const currentTeams = (competitionId) => {
  const table = standings[competitionId] && standings[competitionId].table;
  return Array.isArray(table) && table.length ? new Set(table.map((row) => teamKey(row.name || row.team))) : null;
};
for (const page of registry.pages || []) {
  const ownLeague = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(page.competitionId || "")) ? page.competitionId : "";
  // (a) Takvim bu maçı başka ülkenin aynı adlı ligi olarak işaretliyor.
  const byCalendar = foreignIdentities.has(identityOf(page.homeTeam, page.awayTeam, page.kickoff));
  // (b) Takvim penceresinden çıkmış eski sayfa: iç lig sayfası, ama iki takım
  //     da o ligin GÜNCEL puan durumu tablosunda yok (Ligue 1 sayfasında
  //     Fransa kulübü olmayan maç = başka ülkenin ligi).
  let byTable = false;
  if (ownLeague && domesticIds.has(ownLeague)) {
    const teams = currentTeams(ownLeague);
    byTable = Boolean(teams) && !teams.has(teamKey(page.homeTeam)) && !teams.has(teamKey(page.awayTeam));
  }
  if (ownLeague && (byCalendar || byTable)) removed.push({ ...page, _reason: byCalendar ? "calendar-provider-league-id" : "no-club-in-current-league-table" });
  else kept.push(page);
}

// Daha önce kaldırılmış sayfalar da (rapor dosyasından) temizliğe girer: site
// haritası ve rapor sayfası kanonikleri her koşuda aynı sonuca ulaşsın.
const reportFile = dataPath("league-identity-report.json");
const previouslyRemoved = fs.existsSync(reportFile) ? (read(reportFile).removedMatchPages || []) : [];
const cleanupPages = [
  ...removed,
  ...previouslyRemoved.filter((old) => !removed.some((page) => page.slug === old.slug))
];

// vercel.json yönlendirmeleri: kaldırılan sayfanın adresi maç merkezine 301.
const vercelFile = path.join(root, "vercel.json");
const vercel = read(vercelFile);
const existingSources = new Set((vercel.redirects || []).map((rule) => rule.source));
const newRedirects = [];
for (const page of removed) {
  const pairs = [
    [`/mac/${page.slug}`, "/mac-merkezi.html"],
    [`/mac/${page.slug}.html`, "/mac-merkezi.html"],
    [`/en/match/${page.enSlug}`, "/en/matches.html"],
    [`/en/match/${page.enSlug}.html`, "/en/matches.html"]
  ];
  for (const [source, destination] of pairs) {
    if (!existingSources.has(source)) newRedirects.push({ source, destination, permanent: true });
  }
}

const report = {
  generatedFor: "EMİR 1B / Görev 3 — Fransa Ligue 1 ile aynı adlı liglerin ayrılması",
  calendarRowsFixed: calendarChanged,
  predictionsFixed: predictionsChanged,
  archiveFieldsFixed: archiveChanged,
  foreignMatches: foreignById.size,
  removedMatchPages: removed.map((page) => ({
    slug: page.slug,
    enSlug: page.enSlug,
    match: `${page.homeTeam} - ${page.awayTeam}`,
    homeTeam: page.homeTeam,
    awayTeam: page.awayTeam,
    kickoff: page.kickoff,
    wasCompetitionId: page.competitionId,
    reason: page._reason,
    redirectedTo: ["/mac-merkezi.html", "/en/matches.html"]
  })),
  newRedirectRules: newRedirects.length
};

console.log(JSON.stringify({ ...report, removedMatchPages: report.removedMatchPages.length }, null, 2));

if (apply) {
  const writeMirror = (file) => {
    const mirror = file.replace(`${path.sep}data${path.sep}`, `${path.sep}public${path.sep}data${path.sep}`);
    if (mirror !== file && fs.existsSync(path.dirname(mirror))) return mirror;
    return null;
  };
  if (calendarChanged) {
    write(calendarFile, calendar);
    const mirror = writeMirror(calendarFile);
    if (mirror && fs.existsSync(mirror)) write(mirror, calendar);
  }
  if (predictionsChanged) {
    write(predictionsFile, predictions);
    const mirror = writeMirror(predictionsFile);
    if (mirror && fs.existsSync(mirror)) write(mirror, predictions);
  }
  if (archiveChanged) {
    for (const [key, file] of Object.entries(archiveFiles)) {
      if (!archives[key]) continue;
      write(file, archives[key]);
      const mirror = writeMirror(file);
      if (mirror && fs.existsSync(mirror)) write(mirror, archives[key]);
    }
  }
  if (removed.length) {
    registry.pages = kept;
    write(registryFile, registry);
    for (const page of removed) {
      for (const rel of [`mac/${page.slug}.html`, `en/match/${page.enSlug}.html`, `public/mac/${page.slug}.html`, `public/en/match/${page.enSlug}.html`]) {
        const target = path.join(root, rel);
        if (fs.existsSync(target)) fs.unlinkSync(target);
      }
    }
  }
  if (cleanupPages.length) {
    // Site haritasından da çıkar: yönlendirilen adres haritada durmamalı.
    const gone = new Set(cleanupPages.flatMap((page) => [
      `https://www.futbolradar.com/mac/${page.slug}`,
      `https://www.futbolradar.com/en/match/${page.enSlug}`
    ]));
    for (const rel of ["sitemap.xml", path.join("public", "sitemap.xml")]) {
      const file = path.join(root, rel);
      if (!fs.existsSync(file)) continue;
      const before = fs.readFileSync(file, "utf8");
      const after = before.replace(/[\t ]*<url>[\s\S]*?<\/url>\n?/g, (block) => {
        const loc = /<loc>([^<]+)<\/loc>/.exec(block);
        return loc && gone.has(loc[1].trim()) ? "" : block;
      });
      if (after !== before) fs.writeFileSync(file, after, "utf8");
    }
  }
  if (cleanupPages.length) {
    // Rapor sayfasının yeni kuralı: artık /mac/ hedefi yok, yani İNCE KURAL
    // (scripts/generate-post-match-pages.mjs#THIN_COVERAGE_THRESHOLD) bu sayfaya
    // uygulanır — ince rapor noindex ve haritadan dışarıda, yeterli rapor index ve
    // haritada. Saatlik üretim de aynısını yapar; burada yalnızca o sonuca varılır.
    const generator = fs.readFileSync(path.join(root, "scripts", "generate-post-match-pages.mjs"), "utf8");
    const threshold = Number((generator.match(/^const THIN_COVERAGE_THRESHOLD = (\d+);$/m) || [])[1]);
    const reportStore = fs.existsSync(dataPath("post-match-reports.json")) ? read(dataPath("post-match-reports.json")) : { records: [] };
    const reportsById = new Map((reportStore.records || []).map((record) => [String(record.matchId), record]));
    const today = new Date().toISOString().slice(0, 10);
    const toAdd = [];
    // Rapor dosyası adı: <ev>-<dep>-<YYYY-AA-GG>; sicil slug'ı: <ev>-<dep>-<G>-<ay>-<YYYY>.
    const reportFileFor = (page) => `${page.slug.replace(/-\d{1,2}-[^-]+-\d{4}$/, "")}-${String(page.kickoff).slice(0, 10)}.html`;
    for (const page of cleanupPages) {
      const file = reportFileFor(page);
      if (!fs.existsSync(path.join(root, "mac-raporu", file))) continue;
      const record = reportsById.get(file.replace(/\.html$/, ""));
      // Kaydı olmayan raporun kapsamı BİLİNMİYOR; bilinmeyen kapsam ince sayılır
      // (scripts/test-thin-coverage.mjs ile aynı kural).
      const thin = !(record && Number.isFinite(record.coveragePercent) && record.coveragePercent > threshold);
      for (const rel of ["mac-raporu", path.join("public", "mac-raporu")]) {
        const target = path.join(root, rel, file);
        if (!fs.existsSync(target)) continue;
        const html = fs.readFileSync(target, "utf8");
        const wanted = thin ? "noindex,follow" : "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1";
        const next = html.replace(/(<meta\s+name="robots"\s+content=")[^"]+(")/i, `$1${wanted}$2`);
        if (next !== html) fs.writeFileSync(target, next, "utf8");
      }
      if (!thin) toAdd.push(`https://www.futbolradar.com/mac-raporu/${file}`);
    }
    for (const rel of ["sitemap.xml", path.join("public", "sitemap.xml")]) {
      const file = path.join(root, rel);
      if (!fs.existsSync(file)) continue;
      let xml = fs.readFileSync(file, "utf8");
      let touched = false;
      for (const loc of toAdd) {
        if (xml.includes(`<loc>${loc}</loc>`)) continue;
        xml = xml.replace("</urlset>", `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>\n</urlset>`);
        touched = true;
      }
      if (touched) fs.writeFileSync(file, xml, "utf8");
    }
  }
  if (cleanupPages.length) {
    // Maç raporu sayfaları kanoniklerini kaldırılan /mac/<slug> sayfasına
    // veriyordu; hedef artık yönlendirme. Rapor sayfası kendi kanoniğine döner.
    const bySlug = new Map(cleanupPages.flatMap((page) => [
      [`https://www.futbolradar.com/mac/${page.slug}`, page],
      [`https://www.futbolradar.com/en/match/${page.enSlug}`, page]
    ]));
    for (const dir of ["mac-raporu", path.join("public", "mac-raporu")]) {
      const full = path.join(root, dir);
      if (!fs.existsSync(full)) continue;
      for (const file of fs.readdirSync(full)) {
        if (!file.endsWith(".html")) continue;
        const target = path.join(full, file);
        const before = fs.readFileSync(target, "utf8");
        let after = before;
        for (const gone of bySlug.keys()) {
          if (after.includes(gone)) after = after.split(gone).join(`https://www.futbolradar.com/mac-raporu/${file}`);
        }
        if (after !== before) fs.writeFileSync(target, after, "utf8");
      }
    }
  }
  if (cleanupPages.length) {
    // Dinamik dil eşleme tablosu ve çalışma zamanı dizini kaldırılan sayfaları
    // göstermesin (hreflang/dil kutusu/API aramaları ölü sayfaya gitmesin).
    const goneTr = new Set(cleanupPages.map((page) => `mac/${page.slug}.html`));
    const goneSlugs = new Set(cleanupPages.map((page) => page.slug));
    const routeMapFile = dataPath("en-route-map.json");
    if (fs.existsSync(routeMapFile)) {
      const rows = read(routeMapFile);
      const filtered = rows.filter((row) => !(row && goneTr.has(typeof row.tr === "string" ? row.tr : "")));
      if (filtered.length !== rows.length) write(routeMapFile, filtered);
    }
    const indexFile = dataPath("match-seo-index.json");
    if (fs.existsSync(indexFile)) {
      const index = read(indexFile);
      const entries = Object.entries(index).filter(([, slug]) => !goneSlugs.has(slug));
      // Dosya tek satır (derleme biçimi); biçimi koru, fark yalnızca silinen anahtarlar olsun.
      if (entries.length !== Object.keys(index).length) fs.writeFileSync(indexFile, JSON.stringify(Object.fromEntries(entries)));
    }
  }
  if (cleanupPages.length) {
    // Kaldırılan sayfalara kalan iç bağlantılar: Türkçe listeler maçın RAPOR
    // sayfasına bağlanır (sayfa duruyor), İngilizce listeler satırı düşürür
    // (İngilizce rapor sayfası yok). Hepsi saatlik üretimde zaten yeniden
    // kurulur; burada depodaki hâl 301'e bağımlı kalmasın diye düzeltilir.
    const reportFor = (page) => `${page.slug.replace(/-\d{1,2}-[^-]+-\d{4}$/, "")}-${String(page.kickoff).slice(0, 10)}.html`;
    const walk = (dir, out = []) => {
      if (!fs.existsSync(dir)) return out;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out); else if (entry.name.endsWith(".html")) out.push(full);
      }
      return out;
    };
    const hubFiles = [];
    for (const base of ["", "public"]) {
      for (const file of ["mac-merkezi.html", "mac-takvimi.html", "en/matches.html"]) {
        const full = path.join(root, base, file);
        if (fs.existsSync(full)) hubFiles.push(full);
      }
      for (const dir of ["mac-takvimi", "en/matches", "arsiv"]) hubFiles.push(...walk(path.join(root, base, dir)));
    }
    for (const file of new Set(hubFiles)) {
      const before = fs.readFileSync(file, "utf8");
      let after = before;
      for (const page of cleanupPages) {
        const reportFile = reportFor(page);
        const hasReport = fs.existsSync(path.join(root, "mac-raporu", reportFile));
        // TR: /mac/<slug> → /mac-raporu/<dosya>
        if (hasReport) after = after.split(`mac/${page.slug}"`).join(`mac-raporu/${reportFile}"`);
        // EN: satırı düşür
        const row = new RegExp(`<li class="msp-list-row[^"]*"><a href="[^"]*en/match/${page.enSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">[\\s\\S]*?</a></li>`, "g");
        after = after.replace(row, "");
      }
      if (after !== before) fs.writeFileSync(file, after, "utf8");
    }
    // Rapor sayfalarındaki paylaşım adresleri (URL-kodlu) rapor sayfasının kendisine.
    for (const rel of ["mac-raporu", path.join("public", "mac-raporu")]) {
      const dirPath = path.join(root, rel);
      if (!fs.existsSync(dirPath)) continue;
      for (const page of cleanupPages) {
        const file = reportFor(page);
        const target = path.join(dirPath, file);
        if (!fs.existsSync(target)) continue;
        const before = fs.readFileSync(target, "utf8");
        const after = before
          .split(`https%3A%2F%2Fwww.futbolradar.com%2Fmac%2F${page.slug}`).join(`https%3A%2F%2Fwww.futbolradar.com%2Fmac-raporu%2F${file}`)
          .split(`www.futbolradar.com/mac/${page.slug}`).join(`www.futbolradar.com/mac-raporu/${file}`);
        if (after !== before) fs.writeFileSync(target, after, "utf8");
      }
    }
    // Ölü anahtarlar: bildirim kimlik tablosu ve site haritası tazelik kaydı.
    const goneSlugs = new Set(cleanupPages.flatMap((page) => [page.slug, page.enSlug]));
    for (const rel of [path.join("data", "match-notification-identities.json"), path.join("public", "data", "match-notification-identities.json")]) {
      const file = path.join(root, rel);
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, "utf8");
      const doc = JSON.parse(raw);
      let changed = false;
      for (const section of Object.values(doc)) {
        if (!section || typeof section !== "object") continue;
        for (const [key, value] of Object.entries(section)) {
          const slug = String(value).replace(/^match-page:/, "");
          if (goneSlugs.has(slug) || goneSlugs.has(key)) { delete section[key]; changed = true; }
        }
      }
      if (changed) fs.writeFileSync(file, raw.trimEnd().includes("\n  ") ? `${JSON.stringify(doc, null, 2)}\n` : JSON.stringify(doc));
    }
    const lastmodFile = dataPath("sitemap-lastmod.json");
    if (fs.existsSync(lastmodFile)) {
      const raw = fs.readFileSync(lastmodFile, "utf8");
      const doc = JSON.parse(raw);
      const target = doc.pages || doc;
      let changed = false;
      for (const key of Object.keys(target)) {
        if ([...goneSlugs].some((slug) => key === `mac/${slug}.html` || key === `en/match/${slug}.html`)) { delete target[key]; changed = true; }
      }
      if (changed) fs.writeFileSync(lastmodFile, raw.trimEnd().includes("\n  ") ? `${JSON.stringify(doc, null, 2)}\n` : JSON.stringify(doc));
    }
  }
  if (newRedirects.length) {
    vercel.redirects = [...newRedirects, ...(vercel.redirects || [])];
    fs.writeFileSync(vercelFile, `${JSON.stringify(vercel, null, 2)}\n`);
  }
  if (removed.length || calendarChanged || predictionsChanged || archiveChanged) {
    const previous = fs.existsSync(dataPath("league-identity-report.json")) ? read(dataPath("league-identity-report.json")) : null;
    const merged = previous && previous.removedMatchPages
      ? { ...report, removedMatchPages: [...previous.removedMatchPages, ...report.removedMatchPages.filter((p) => !previous.removedMatchPages.some((q) => q.slug === p.slug))] }
      : report;
    write(dataPath("league-identity-report.json"), merged);
  }
} else {
  console.log("(kuru koşu — yazmak için --apply)");
}
