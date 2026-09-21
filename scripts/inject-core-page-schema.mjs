#!/usr/bin/env node
/**
 * ÇEKİRDEK GEZİNTİ SAYFALARINA YAPISAL VERİ EKLER.
 *
 * Üretilen sayfalar (maç, oyuncu, haber, arşiv, köşe yazısı) kendi
 * üreticilerinde JSON-LD alıyor. ELLE BAKILAN çekirdek sayfalar — puan
 * durumu, bugünün maçları, takımlar, Süper Lig fikstürü, analizler, maç
 * merkezi... — hiç almıyordu. Bunlar sitenin en çok arama trafiği alması
 * beklenen sayfaları: Google için ne olduklarını söyleyen tek işaret
 * `<title>` idi.
 *
 * NE EKLENİR
 *   • WebPage        — sayfanın kendi başlığı, açıklaması ve canonical'ı.
 *   • BreadcrumbList — Ana Sayfa → (bölüm) → sayfa.
 *   • ItemList       — YALNIZCA gerçekten liste olan sayfalarda ve yalnızca
 *                      sayfada görünen gerçek kayıtlardan.
 *   • SportsEvent    — YALNIZCA gün/saati DOĞRULANMIŞ fikstürler için.
 *
 * NE EKLENMEZ. Sayfada karşılığı olmayan hiçbir alan. Şemaya uydurma veri
 * konmaz: başlama saati atanmamış bir maç `SportsEvent` olarak yazılmaz,
 * açıklaması olmayan sayfaya açıklama üretilmez. Eksik alan, yanlış alandan
 * iyidir — yanlış yapısal veri hem okuyucuyu hem Google'ı yanıltır ve
 * zengin sonuç cezası riski taşır.
 *
 * Kullanım: node scripts/inject-core-page-schema.mjs [--check]
 *   --check  hiçbir şey yazmaz; eksik sayfa varsa 1 döner (QA için).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { CONFIRMED_FIXTURE_STATUSES } = require("../services/superLigFixtureService.js");

const CHECK_ONLY = process.argv.includes("--check");
const DOMAIN = "https://www.futbolradar.com";
const MARKER_START = "<!-- core-page-schema:start -->";
const MARKER_END = "<!-- core-page-schema:end -->";

/**
 * Sayfa → kırıntı yolu. "Ana Sayfa" her zaman ilk halka; ikinci halka
 * sayfanın gerçekten ait olduğu bölüm, uydurulmuş bir kategori değil.
 */
const PAGES = {
  "analizler.html": { section: null, kind: "collection" },
  "asist-kralligi.html": { section: { name: "Oyuncu Radarı", href: "oyuncu-radari.html" }, kind: "collection" },
  "bahis-sonuclari.html": { section: { name: "Maç Merkezi", href: "mac-merkezi.html" }, kind: "collection" },
  "bugunun-maclari.html": { section: { name: "Maç Merkezi", href: "mac-merkezi.html" }, kind: "collection" },
  "canli-mac-sonuclari.html": { section: { name: "Maç Merkezi", href: "mac-merkezi.html" }, kind: "collection" },
  "derbi-radari.html": { section: { name: "Maç Merkezi", href: "mac-merkezi.html" }, kind: "collection" },
  "iddaa-sonuclari.html": { section: { name: "Maç Merkezi", href: "mac-merkezi.html" }, kind: "collection" },
  "mac-sonuclari.html": { section: { name: "Maç Merkezi", href: "mac-merkezi.html" }, kind: "collection" },
  "futbol-radar-rehberi.html": { section: null, kind: "page" },
  "gol-kralligi.html": { section: { name: "Oyuncu Radarı", href: "oyuncu-radari.html" }, kind: "collection" },
  "gunun-radar-bulteni.html": { section: null, kind: "page" },
  "haftanin-maclari.html": { section: { name: "Maç Merkezi", href: "mac-merkezi.html" }, kind: "collection" },
  "mac-merkezi.html": { section: null, kind: "collection" },
  "momentum.html": { section: { name: "Takımlar", href: "takimlar.html" }, kind: "collection" },
  "oyuncu-liderleri.html": { section: { name: "Oyuncu Radarı", href: "oyuncu-radari.html" }, kind: "collection" },
  "puan-durumu.html": { section: null, kind: "collection", list: "standings" },
  "super-lig-fikstur.html": { section: { name: "Maç Merkezi", href: "mac-merkezi.html" }, kind: "fixtures" },
  "takim-trendleri.html": { section: { name: "Takımlar", href: "takimlar.html" }, kind: "collection" },
  "takimlar.html": { section: null, kind: "collection" },
  "transfer-izleme.html": { section: { name: "Oyuncu Radarı", href: "oyuncu-radari.html" }, kind: "collection" }
};

function readPage(file) {
  const full = path.join(root, file);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
}

function attr(html, pattern) {
  const match = html.match(pattern);
  return match ? match[1].trim() : "";
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

/**
 * Gün/saati DOĞRULANMIŞ Süper Lig maçları. `confirmed-pairing` (eşleşme
 * belli, tarih yok) buraya GİRMEZ: `startDate` olmadan SportsEvent geçersiz,
 * uydurulmuş bir tarihle yazmak ise okuyucuya yalan söylemek olur.
 */
function confirmedFixtureEvents() {
  const fixtures = JSON.parse(fs.readFileSync(path.join(root, "data", "super-lig-fixtures.json"), "utf8"));
  const events = [];

  for (const round of fixtures.rounds || []) {
    for (const match of round.matches || []) {
      if (!match.kickoff || !CONFIRMED_FIXTURE_STATUSES.has(match.fixtureStatus)) continue;
      const event = {
        "@type": "SportsEvent",
        name: `${match.homeTeam} - ${match.awayTeam}`,
        startDate: match.kickoff,
        eventStatus: "https://schema.org/EventScheduled",
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        homeTeam: { "@type": "SportsTeam", name: match.homeTeam },
        awayTeam: { "@type": "SportsTeam", name: match.awayTeam },
        superEvent: { "@type": "SportsOrganization", name: fixtures.league || "Süper Lig" }
      };
      // Stat yalnızca kayıtlıysa yazılır.
      if (match.venue) event.location = { "@type": "Place", name: match.venue };
      events.push(event);
    }
  }

  return events;
}

/**
 * Puan durumu `ItemList`i — SAYFANIN KENDİ HTML'İNDEN okunur.
 *
 * Şemanın altın kuralı: bildirilen hiçbir alan sayfada görünmeyen bir
 * bilgi olamaz. Veriyi `data/`den okusaydık bu garanti kaybolurdu —
 * tablo istemci tarafından yenilenip şema eski kalabilir ya da tersi.
 * Ön-üretilmiş satırları ayrıştırmak ikisini tanım gereği aynı tutuyor:
 * satır sayfada yoksa şemada da yok.
 *
 * Başlık satırı (`is-head`) dışarıda: o bir takım değil, sütun adı.
 */
const STANDING_ROW_RE = /<div class="home-standing-row(?! is-head)[^"]*"[^>]*>([\s\S]*?)<\/div>/g;

function standingsRows(html) {
  const rows = [];
  for (const [, inner] of html.matchAll(STANDING_ROW_RE)) {
    const rank = Number(attr(inner, /<span class="home-standing-rank">([^<]*)<\/span>/));
    const name = decodeEntities(attr(inner, /<a class="home-standing-team"[\s\S]*?<b>([^<]*)<\/b>/));
    if (!name || !Number.isFinite(rank)) continue;
    rows.push({ rank, name });
  }
  return rows.sort((left, right) => left.rank - right.rank);
}

function buildGraph(file, config, html) {
  const title = decodeEntities(attr(html, /<title>([\s\S]*?)<\/title>/));
  const description = decodeEntities(attr(html, /<meta name="description" content="([^"]*)"/));
  const canonical = attr(html, /<link rel="canonical" href="([^"]*)"/) || `${DOMAIN}/${file}`;

  if (!title) return null;

  const crumbs = [{ name: "Ana Sayfa", item: `${DOMAIN}/` }];
  if (config.section) crumbs.push({ name: config.section.name, item: `${DOMAIN}/${config.section.href}` });
  // Son halka sayfanın kendisi; başlıktan site adı eki temizlenir.
  crumbs.push({ name: title.split("|")[0].trim(), item: canonical });

  const webPage = {
    "@type": config.kind === "collection" || config.kind === "fixtures" ? "CollectionPage" : "WebPage",
    "@id": canonical,
    url: canonical,
    name: title,
    isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${DOMAIN}/` },
    inLanguage: "tr-TR"
  };
  if (description) webPage.description = description;

  const graph = [
    webPage,
    {
      "@type": "BreadcrumbList",
      itemListElement: crumbs.map((crumb, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: crumb.name,
        item: crumb.item
      }))
    }
  ];

  if (config.list === "standings") {
    const rows = standingsRows(html);
    if (rows.length) {
      graph.push({
        "@type": "ItemList",
        name: title.split("|")[0].trim(),
        numberOfItems: rows.length,
        itemListOrder: "https://schema.org/ItemListOrderAscending",
        // Sıra `position`da, takım adı `name`de. PUAN YAZILMIYOR:
        // schema.org'un `SportsTeam` tipinde lig puanını taşıyan bir alan
        // yok ve `award` gibi yakın duran bir alana sıkıştırmak, alanın
        // anlamını eğip bükmek olur. Emin olunmayan alan boş bırakılmaz,
        // HİÇ yazılmaz.
        itemListElement: rows.map((row) => ({
          "@type": "ListItem",
          position: row.rank,
          item: { "@type": "SportsTeam", name: row.name }
        }))
      });
    }
  }

  if (config.kind === "fixtures") {
    const events = confirmedFixtureEvents();
    if (events.length) {
      graph.push({
        "@type": "ItemList",
        name: "Doğrulanmış Süper Lig maçları",
        numberOfItems: events.length,
        itemListElement: events.map((event, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: event
        }))
      });
    }
  }

  return { "@context": "https://schema.org", "@graph": graph };
}

function injectedBlock(graph) {
  return `${MARKER_START}\n<script type="application/ld+json">${JSON.stringify(graph)}</script>\n${MARKER_END}`;
}

function applyTo(html, block) {
  if (html.includes(MARKER_START)) {
    return html.replace(new RegExp(`${MARKER_START}[\\s\\S]*?${MARKER_END}`), block);
  }
  // Kırıntı ve şema başlıkta durmalı; </head>'in hemen öncesine yazılır.
  return html.replace(/<\/head>/i, `${block}\n</head>`);
}

let written = 0;
let unchanged = 0;
const missing = [];

for (const [file, config] of Object.entries(PAGES)) {
  const html = readPage(file);
  if (html === null) continue;

  const graph = buildGraph(file, config, html);
  if (!graph) {
    missing.push(`${file}: başlık okunamadı`);
    continue;
  }

  const block = injectedBlock(graph);
  const next = applyTo(html, block);

  if (!next.includes(MARKER_START)) {
    missing.push(`${file}: </head> bulunamadı`);
    continue;
  }

  if (next === html) {
    unchanged += 1;
    continue;
  }

  if (CHECK_ONLY) {
    missing.push(`${file}: yapısal veri güncel değil`);
    continue;
  }

  fs.writeFileSync(path.join(root, file), next, "utf8");
  const mirror = path.join(root, "public", file);
  if (fs.existsSync(mirror)) fs.writeFileSync(mirror, next, "utf8");
  written += 1;
}

if (CHECK_ONLY) {
  if (missing.length) {
    console.error(`Çekirdek sayfa şeması eksik/güncel değil:\n  ${missing.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`Çekirdek sayfa şeması güncel (${unchanged} sayfa).`);
} else {
  console.log(`Core page schema: ${written} sayfa güncellendi, ${unchanged} zaten güncel.`);
  if (missing.length) console.warn(`  atlandı:\n  ${missing.join("\n  ")}`);
}
