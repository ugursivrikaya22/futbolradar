#!/usr/bin/env node
/**
 * ANA SAYFA MAÇ VİTRİNİNİ YAZ / KALDIR.
 *
 * Yapılandırmadaki kulübün (varsayılan: Beşiktaş) maçı, maçtan
 * `openBeforeHours` saat önce ana sayfanın en üstünde açılır; maç öncesi,
 * maç sırasında ve maç sonrasında aynı kutuda kalır ve GERÇEK bitiş
 * düdüğünden `dwellAfterFinishMinutes` (varsayılan 120) dakika sonra
 * ana sayfadan düşer.
 *
 * ── MAÇ SAYFASI KALICIDIR ────────────────────────────────────────────────
 * Bu betik YALNIZCA geçici öne çıkarmayı yönetir. `/mac/<slug>` ve
 * `/en/match/<slug>` sayfalarını ne siler, ne `noindex` yapar, ne de
 * yönlendirir; vitrin kapandıktan sonra da sayfa aynı adreste
 * indekslenebilir kalır ve maç sonrası aramalardan ("maç sonucu",
 * "golleri", "maç özeti") trafik toplamaya devam eder. Adres hiçbir evrede
 * değişmez.
 *
 * ── ADRES TÜRETİLMEZ, SİCİLDEN OKUNUR ────────────────────────────────────
 * Kutudaki bağlantı `data/match-seo-pages.json` sicilinden gelir; o sicili
 * sayfaları GERÇEKTEN yazan üretici (`generate-match-seo-pages.mjs`)
 * tutuyor. Burada ikinci bir slug kuralı yazmak, üretici bir adres
 * değiştirdiğinde ana sayfayı 404'e bağlamak olurdu.
 *
 * ── DURUM VE SKOR VERİ KATMANINDAN GELİR ─────────────────────────────────
 * Sicil kaydı, `data/fixture-calendar.json` ve kürasyonlu kayıtlarla
 * örtüşür; en ileri durum ve okunabilir skor kazanır. Skor yoksa kutuda
 * skor satırı hiç basılmaz — tahmini skor yazılmaz.
 *
 * Kullanım:
 *   node scripts/generate-featured-match-spotlight.mjs           # yaz
 *   node scripts/generate-featured-match-spotlight.mjs --check   # CI kapısı
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spotlightBlock, spotlightStrip } from "./lib/featuredMatchSpotlight.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const CHECK_ONLY = process.argv.includes("--check");
/**
 * `--dry-run` hiçbir dosyaya dokunmaz, seçilen maçı ve kutuyu basar;
 * `--now=<ISO>` saati sabitler. İkisi birlikte, maçın canlı ve maç sonrası
 * hâlini yayına çıkmadan görmeyi sağlar — kutunun 2 saatlik kapanışını
 * gerçek maçı beklemeden denetlemenin tek dürüst yolu.
 */
const DRY_RUN = process.argv.includes("--dry-run");
const NOW_OVERRIDE = (process.argv.find((arg) => arg.startsWith("--now=")) || "").slice("--now=".length);

const spotlight = require("../services/featuredMatchSpotlight.js");
const { isHomeFixture } = require("../services/homeFixtureVisibility.js");
const { istanbulDay, matchState } = require("../services/matchStatus.js");
const { identityOf } = require("../services/matchSeoPages.js");
const { competitionLabel } = require("../services/i18n.js");
const { nationLabel } = require("../services/displayLabels.js");

/**
 * A Millî Takım adları — `services/matchSeoPages.js` ile AYNI küme.
 * Kutuya millî takım merkezinin bağlantısını yalnızca gerçekten millî bir
 * maçta basmak için kullanılır; seçim kuralına karışmaz.
 */
const NATIONAL_TEAM_NAMES = ["Türkiye", "Turkey"];

const CONFIG_PATH = "data/featured-match-spotlight.json";
const STATE_PATH = "data/featured-match-spotlight-state.json";

const HOME_START = "<!-- featured-match-spotlight:start -->";
const HOME_END = "<!-- featured-match-spotlight:end -->";
const HOME_BLOCK_RE = /[\t ]*<!-- featured-match-spotlight:start -->[\s\S]*?<!-- featured-match-spotlight:end -->\r?\n?/g;

const STRIP_START = "<!-- featured-match-strip:start -->";
const STRIP_END = "<!-- featured-match-strip:end -->";
const STRIP_BLOCK_RE = /[\t ]*<!-- featured-match-strip:start -->[\s\S]*?<!-- featured-match-strip:end -->\r?\n?/g;

const ASSETS_START = "<!-- featured-match-spotlight:assets:start -->";
const ASSETS_END = "<!-- featured-match-spotlight:assets:end -->";
const ASSETS_BLOCK_RE = /[\t ]*<!-- featured-match-spotlight:assets:start -->[\s\S]*?<!-- featured-match-spotlight:assets:end -->\r?\n?/g;
/** `.test()` için ayrı, genel olmayan kopya: genel bayrak `lastIndex` taşır. */
const HAS_ASSETS_RE = /<!-- featured-match-spotlight:assets:start -->/;

/** Ana sayfada kutu hero'nun hemen ardına girer; maç dosyası kutusundan önce. */
const HERO_END_RE = /(<section class="container hero" id="hero-canli-skor"[\s\S]*?<\/section>\r?\n)/;
/**
 * Takım/lig sayfasında şerit sayfa yolunun (breadcrumb) hemen ardına girer.
 * Sayfa yolu taşımayan yüzeylerde (bazı İngilizce puan durumu sayfaları)
 * `<main>` açılışı yedek çapa: şerit yine de en üstte kalır.
 */
const STRIP_ANCHORS = [
  /(<nav class="breadcrumb"[\s\S]*?<\/nav>\r?\n)/,
  /(<main[^>]*>\r?\n)/
];

/** İngilizce lig sayfası karşılıkları; karşılığı olmayan lig için şerit basılmaz. */
const EN_LEAGUE_PAGES = {
  "avrupa-ligi": "en/europa-league-standings.html",
  "sampiyonlar-ligi": "en/champions-league-standings.html",
  "konferans-ligi": "en/conference-league-standings.html",
  "super-lig": "en/super-lig-standings.html"
};

function readJson(relative, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  } catch {
    return fallback;
  }
}

function writeFile(relative, text) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === text) return false;
  fs.writeFileSync(target, text, "utf8");
  return true;
}

/** Kök ve `public/` kopyası birlikte güncellenir. */
function targetsFor(relative) {
  return [relative, `public/${relative}`].filter((file) => fs.existsSync(path.join(root, file)));
}

/** `en/team/besiktas.html` → `../../`; kök sayfalar → `./`. */
function baseFor(relative) {
  const depth = relative.split("/").length - 1;
  return depth === 0 ? "./" : "../".repeat(depth);
}

const config = readJson(CONFIG_PATH, {}) || {};
const settings = spotlight.withDefaults(config);
const now = NOW_OVERRIDE && Number.isFinite(Date.parse(NOW_OVERRIDE)) ? Date.parse(NOW_OVERRIDE) : Date.now();
const nowIso = new Date(now).toISOString();

/* ────────────────────────────── ADAY HAVUZU ──────────────────────────── */

const registry = readJson("data/match-seo-pages.json", { pages: [] });
const registryPages = Array.isArray(registry && registry.pages) ? registry.pages : [];

/** Sicil dışı kaynaklar: yalnızca durum/skor tazeliği için okunur. */
function freshRecords() {
  const calendar = readJson("data/fixture-calendar.json", { matches: [] });
  const fixtures = Array.isArray(calendar) ? calendar : (calendar && calendar.matches) || [];
  let curated = [];
  try {
    curated = require("../services/providers/mockProvider.js").allCuratedMatchesUnfiltered();
  } catch {
    curated = [];
  }
  return [...fixtures, ...(Array.isArray(curated) ? curated : [])];
}

const freshByIdentity = new Map();
for (const record of freshRecords()) {
  const key = identityOf(record);
  if (!key) continue;
  const current = freshByIdentity.get(key);
  if (!current || spotlightRank(record) >= spotlightRank(current)) freshByIdentity.set(key, record);
}

function spotlightRank(record) {
  const state = matchState(record);
  const order = { FINISHED: 4, AWARDED: 4, LIVE: 3, HALFTIME: 3, INTERRUPTED: 3, POSTPONED: 2, CANCELLED: 2, SCHEDULED: 1, UNKNOWN: 0 };
  return order[state] ?? 0;
}

/**
 * Sicil kaydı + en taze durum/skor. Sicil adresi ve maç olgularını taşır;
 * taze kayıt yalnızca durum, skor, dakika ve güncelleme damgasını ezer.
 */
function candidateFrom(entry) {
  const identity = entry.identity || identityOf(entry);
  const fresh = identity ? freshByIdentity.get(identity) : null;
  const merged = {
    ...entry,
    id: entry.slug,
    status: entry.status,
    providerStatus: entry.providerStatus,
    score: entry.score,
    minute: entry.minute
  };

  // Canlı yoklama için sağlayıcı kimliği: `/api/match-detail` fikstür
  // kimliğiyle sorgulanıyor ve o kimlik yalnızca takvim/kürasyon
  // kaydında var.
  if (fresh && fresh.id) merged.providerMatchId = fresh.id;
  // API-FOOTBALL FİKSTÜR KİMLİĞİ ÖNCELİKLİ. `id=<doğal kimlik>` sorgusu
  // `/api/match-detail`te sağlayıcıya gitmiyor, depodaki (derleme anı)
  // kaydı döndürüyor: 11 Ekim Beşiktaş - Kocaelispor maçı bittikten saatler
  // sonra bile vitrin "NS" okuyup "Maç önü"nde kaldı. Maç sayfası
  // (generate-match-seo-pages) zaten `fixtureId=` ile yokluyor; vitrin de
  // aynı sözleşmeyi kullanır.
  const apiFootballId = fresh && ((fresh.providerIds && fresh.providerIds.apiFootball) || (/^\d+$/.test(String(fresh.providerId || "")) ? fresh.providerId : ""));
  if (apiFootballId) merged.providerFixtureId = String(apiFootballId);

  if (fresh && spotlightRank(fresh) >= spotlightRank(entry)) {
    merged.status = fresh.status || merged.status;
    merged.providerStatus = fresh.providerStatus || merged.providerStatus;
    merged.minute = fresh.minute ?? merged.minute;
    if (fresh.score && (fresh.score.home !== null && fresh.score.home !== undefined)) merged.score = fresh.score;
    merged.updatedAt = fresh.updatedAt || fresh.fetchedAt || merged.updatedAt;
  }

  return merged;
}

const candidates = registryPages
  .filter((entry) => entry && entry.slug && entry.homeTeam && entry.awayTeam && entry.kickoff)
  .filter((entry) => spotlight.involvesTeam(entry, settings.teams))
  .map(candidateFrom);

/* ──────────────────────── SEÇİM VE BİTİŞ DAMGASI ─────────────────────── */

const previousState = readJson(STATE_PATH, {});
const observed = (previousState && previousState.finishedAt) || {};

const enabled = config.enabled !== false && settings.teams.length > 0;
const selected = enabled ? spotlight.selectSpotlight(candidates, { ...config, nowMs: now, observed }) : null;

let nextObserved = observed;
for (const candidate of candidates) {
  nextObserved = spotlight.nextObservedState(nextObserved, candidate, now);
}
nextObserved = spotlight.pruneObservedState(nextObserved, now);

const finalWhistle = selected ? spotlight.finalWhistleAt(selected, now, config, nextObserved[selected.id]) : null;
const expiry = selected ? spotlight.clientExpiryAt(selected, now, config, nextObserved[selected.id]) : { at: null, exact: false };

const stateFile = {
  _comment: "MAÇ VİTRİNİ DURUMU — ÜRETİLİR, ELLE DÜZENLENMEZ. `finishedAt`, bir maçın sağlayıcıda İLK KEZ bitmiş görüldüğü andır; 2 saatlik ana sayfa sayacı bu damgadan başlar ve damga bir daha değişmez. Maç yeniden canlıya dönerse ya da ertelenirse damga silinir, sayaç gerçek düdüğü bekler.",
  updatedAt: nowIso,
  spotlight: selected
    ? {
        matchId: selected.id,
        homeTeam: selected.homeTeam,
        awayTeam: selected.awayTeam,
        kickoff: selected.kickoff,
        phase: spotlight.phaseOf(selected, now, config),
        finalWhistleAt: finalWhistle ? new Date(finalWhistle).toISOString() : null,
        removeFromHomeAt: expiry.at ? new Date(expiry.at).toISOString() : null,
        removalIsExact: expiry.exact
      }
    : null,
  finishedAt: nextObserved
};

/* ───────────────────────────── İŞARETLEME ────────────────────────────── */

function viewFor(entry, locale, base) {
  const trPath = `mac/${entry.slug}`;
  const enPath = entry.enSlug ? `en/match/${entry.enSlug}` : "";
  const target = locale === "en" && enPath ? enPath : trPath;
  const day = istanbulDay(entry.kickoff) || "";

  // Kimlik yoksa sorgu hiç yazılmaz: istemci o zaman yoklama yapmaz ve
  // kutu sunucunun bastığı anlık görüntüde kalır. Uydurma bir kimlikle
  // yanlış maçı çizmektense hiç çizmemek doğru davranış.
  const query = entry.providerFixtureId && day
    ? `fixtureId=${encodeURIComponent(entry.providerFixtureId)}&date=${encodeURIComponent(day)}`
    : entry.providerMatchId && day
      ? `id=${encodeURIComponent(entry.providerMatchId)}&date=${encodeURIComponent(day)}`
      : "";

  const phase = spotlight.phaseOf(entry, now, config);

  // A MİLLÎ TAKIM SAYFASINA BAĞLANTI, YALNIZCA SAYFA GERÇEKTEN VARSA.
  // Millî maçta okuyucu kadro, grup durumu ve son gelişmeler için tek bir
  // merkez arıyor; kulüp maçında böyle bir merkez yok, o yüzden bağlantı
  // koşullu. Adres diskte doğrulanıyor: olmayan bir sayfaya bağlanmak
  // hiç bağlanmamaktan kötüdür.
  const hubRelative = locale === "en" ? "en/turkey-national-team.html" : "milli-takim.html";
  const hubExists = fs.existsSync(path.join(root, hubRelative));
  const isNational = spotlight.involvesTeam(entry, NATIONAL_TEAM_NAMES);
  const extraLinks = isNational && hubExists
    ? [{ href: `${base}${hubRelative.replace(/\.html$/, "")}`, label: locale === "en" ? "Türkiye national team hub" : "A Millî Takım sayfası" }]
    : [];

  return {
    // GÖRÜNEN AD: İngilizce yüzeyde ülke adı İngilizce ("İtalya" → "Italy"),
    // tıpkı kutunun bağlandığı maç sayfasının tabelası gibi. Kulüp adına
    // dokunulmaz (services/displayLabels.js#nationLabel).
    homeTeam: nationLabel(entry.homeTeam, locale),
    awayTeam: nationLabel(entry.awayTeam, locale),
    // EŞLEŞME ANAHTARI: ham ad. İstemci sağlayıcı kaydını bu adla bu maça
    // bağlıyor; çevrilse canlı skor kutuya hiç yazılamazdı.
    matchHome: entry.homeTeam,
    matchAway: entry.awayTeam,
    major: spotlight.isMajorSpotlight(entry, config, phase),
    extraLinks,
    // Geri sayımın sunucu tarafı başlangıç değeri bu ana göre hesaplanır;
    // saniyeyi istemci sayar (ek istek yok).
    renderedAt: new Date(now).toISOString(),
    // Lig adı iki dilde ayrı: İngilizce yüzeyde "Avrupa Ligi" yazmak,
    // maç sayfasının kendi başlığıyla ("Europa League") çelişirdi.
    league: entry.league ? competitionLabel(entry.league, locale) : "",
    venue: entry.venue,
    referee: entry.referee,
    broadcast: entry.broadcast && entry.broadcast.turkey ? entry.broadcast.turkey : "",
    kickoff: entry.kickoff,
    score: entry.score,
    minute: entry.minute,
    phase,
    href: `${base}${target}`,
    query,
    expiresAt: expiry.at ? new Date(expiry.at).toISOString() : "",
    todayIstanbul: istanbulDay(new Date(now).toISOString()) || ""
  };
}

function assetsTag(base) {
  return `${ASSETS_START}<link rel="stylesheet" href="${base}featured-match-spotlight.css" /><script src="${base}featured-match-spotlight.js" defer></script>${ASSETS_END}`;
}

const problems = [];
let updated = 0;

/** İşaretli bloğu söker, gerekiyorsa yenisini yazar. */
function applyBlock({ relative, blockRe, anchors, block, anchorLabel, withAssets }) {
  const base = baseFor(relative);
  for (const file of targetsFor(relative)) {
    const absolute = path.join(root, file);
    const original = fs.readFileSync(absolute, "utf8");
    let next = original.replace(blockRe, "");

    if (block) {
      const insertRe = anchors.find((candidate) => candidate.test(next));
      if (!insertRe) {
        problems.push(`${file}: ${anchorLabel} bulunamadı, vitrin yazılamadı`);
        continue;
      }
      next = next.replace(insertRe, (found) => `${found}      ${block}\n`);
      // VARLIK BLOĞU YERİNDEYSE DOKUNULMAZ. `inject-asset-version` bu
      // satırlara içerik damgası (`?v=…`) ekliyor; bloğu her koşuda söküp
      // damgasız hâliyle geri yazmak `--check` kapısını kalıcı kırmızıya
      // çevirirdi. Blok yalnızca yoksa eklenir, vitrin kapanınca sökülür.
      if (withAssets && !HAS_ASSETS_RE.test(next)) {
        next = next.replace("</head>", `${assetsTag(base)}</head>`);
      }
    } else {
      next = next.replace(ASSETS_BLOCK_RE, "");
    }

    if (next === original) continue;
    if (CHECK_ONLY) {
      problems.push(`${file}: maç vitrini güncel değil`);
      continue;
    }
    if (DRY_RUN) continue;
    fs.writeFileSync(absolute, next, "utf8");
    updated += 1;
  }
}

const homePages = [
  { relative: "index.html", locale: "tr" },
  { relative: "en/index.html", locale: "en" }
];

for (const page of homePages) {
  const base = baseFor(page.relative);
  const block = selected && isHomeFixture(selected, now) && ['pre', 'live'].includes(spotlight.phaseOf(selected, now, config))
    ? `${HOME_START}${spotlightBlock(viewFor(selected, page.locale, base), { locale: page.locale })}\n      ${HOME_END}`
    : "";
  applyBlock({
    relative: page.relative,
    blockRe: HOME_BLOCK_RE,
    anchors: [HERO_END_RE],
    block,
    anchorLabel: "hero bölümü",
    withAssets: true
  });
}

/* Takım ve lig sayfasındaki iç bağlantı şeridi. Hedef dosya yoksa sessizce
   atlanır: her lig ve her takım için ayrı sayfa olmak zorunda değil. */
function stripTargets(entry) {
  if (!entry) return [];
  const teamSlug = spotlight.normalizeName(spotlight.spotlightSideOf(entry, settings.teams) === "away" ? entry.awayTeam : entry.homeTeam).replace(/\s+/g, "-");
  const competitionId = entry.competitionId || "";

  return [
    { relative: `${teamSlug}-maclari.html`, locale: "tr" },
    { relative: `en/team/${teamSlug}.html`, locale: "en" },
    { relative: competitionId ? `lig/${competitionId}.html` : "", locale: "tr" },
    { relative: EN_LEAGUE_PAGES[competitionId] || "", locale: "en" }
  ].filter((target) => target.relative && fs.existsSync(path.join(root, target.relative)));
}

const stripPages = new Set();
for (const target of stripTargets(selected)) {
  stripPages.add(`${target.relative}|${target.locale}`);
  const base = baseFor(target.relative);
  const view = viewFor(selected, target.locale, base);
  const block = `${STRIP_START}${spotlightStrip(view, { locale: target.locale })}\n      ${STRIP_END}`;
  applyBlock({
    relative: target.relative,
    blockRe: STRIP_BLOCK_RE,
    anchors: STRIP_ANCHORS,
    block,
    anchorLabel: "sayfa yolu (breadcrumb)",
    withAssets: true
  });
}

/* Artık vitrinde olmayan sayfalardaki eski şeritler sökülür. Maç değişince
   önceki maçın şeridi başka bir takım/lig sayfasında kalabilirdi. */
for (const relative of listStrippedPages()) {
  if ([...stripPages].some((key) => key.startsWith(`${relative}|`))) continue;
  for (const file of targetsFor(relative)) {
    const absolute = path.join(root, file);
    const original = fs.readFileSync(absolute, "utf8");
    const next = original.replace(STRIP_BLOCK_RE, "").replace(ASSETS_BLOCK_RE, "");
    if (next === original) continue;
    if (CHECK_ONLY) {
      problems.push(`${file}: eski maç vitrini şeridi sökülmemiş`);
      continue;
    }
    if (DRY_RUN) continue;
    fs.writeFileSync(absolute, next, "utf8");
    updated += 1;
  }
}

/** Şerit basılmış olabilecek sayfalar: takım sayfaları + lig sayfaları. */
function listStrippedPages() {
  const out = [];
  for (const file of fs.readdirSync(root)) {
    if (/-maclari\.html$/.test(file)) out.push(file);
  }
  for (const dir of ["lig", "en/team"]) {
    const absolute = path.join(root, dir);
    if (!fs.existsSync(absolute)) continue;
    for (const file of fs.readdirSync(absolute)) {
      if (file.endsWith(".html")) out.push(`${dir}/${file}`);
    }
  }
  for (const file of Object.values(EN_LEAGUE_PAGES)) out.push(file);
  return [...new Set(out)];
}

/* ─────────────────────────── VARLIK KOPYALARI ────────────────────────── */

for (const asset of ["featured-match-spotlight.css", "featured-match-spotlight.js"]) {
  const source = path.join(root, asset);
  if (!fs.existsSync(source)) continue;
  const text = fs.readFileSync(source, "utf8");
  if (CHECK_ONLY) {
    const copy = path.join(root, "public", asset);
    if (!fs.existsSync(copy) || fs.readFileSync(copy, "utf8") !== text) problems.push(`public/${asset}: kopya güncel değil`);
    continue;
  }
  if (DRY_RUN) continue;
  if (writeFile(`public/${asset}`, text)) updated += 1;
}

if (!CHECK_ONLY && !DRY_RUN) {
  writeFile(STATE_PATH, `${JSON.stringify(stateFile, null, 2)}\n`);
}

if (DRY_RUN) {
  console.log(JSON.stringify(stateFile.spotlight, null, 2));
  if (selected) console.log(spotlightBlock(viewFor(selected, "tr", "./"), { locale: "tr" }));
}

/* ────────────────────────────── RAPORLAMA ────────────────────────────── */

if (problems.length) {
  console.error("featured-match-spotlight FAILED:");
  problems.forEach((line) => console.error(`  - ${line}`));
  process.exitCode = 1;
} else if (CHECK_ONLY) {
  console.log("featured-match-spotlight: vitrin güncel.");
} else if (selected) {
  console.log(
    `featured-match-spotlight: "${selected.homeTeam} – ${selected.awayTeam}" (${stateFile.spotlight.phase}) — `
    + `ana sayfadan düşme: ${stateFile.spotlight.removeFromHomeAt || "bitiş düdüğü bekleniyor"}`
    + `${stateFile.spotlight.removalIsExact ? "" : " (tahmini; gerçek düdük gelince kesinleşir)"}; ${updated} dosya güncellendi.`
  );
} else {
  console.log(`featured-match-spotlight: penceresi açık maç yok, kutu basılmadı (${updated} dosya güncellendi).`);
}
