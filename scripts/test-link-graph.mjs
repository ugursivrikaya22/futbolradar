#!/usr/bin/env node
/**
 * İÇ BAĞLANTI GRAFI.
 *
 * Saf seçim kuralları (sıra, tavan, görünür ve açıklayıcı çapa, TR/EN)
 * ve üretilmiş ağaçta kilit sayfaların en az N farklı sayfadan bağlantı
 * alması. `public/` aynası sayılmaz.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findTurkish } from "./lib/turkish-detector.mjs";
import {
  CAP,
  LEAGUE_PRIORITY,
  WEAK_LEAGUE_IDS,
  orderLeagues,
  relatedLeagues,
  selectTeamLinks,
  selectNewsLinks,
  summerHubLinks,
  renderStrip,
  upsertMarked,
  normalizeHref,
  scanInbound,
  isSummer2026
} from "./lib/contextualLinkGraph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
console.log("link-graph");

{
  const leagues = [
    { id: "eredivisie", nameTr: "Eredivisie", nameEn: "Eredivisie" },
    { id: "super-lig", nameTr: "Süper Lig", nameEn: "Süper Lig" },
    { id: "la-liga", nameTr: "La Liga", nameEn: "La Liga" },
    { id: "sampiyonlar-ligi", nameTr: "Şampiyonlar Ligi", nameEn: "Champions League" },
    { id: "ligue-1", nameTr: "Ligue 1", nameEn: "Ligue 1" },
    { id: "arjantin-primera", nameTr: "Arjantin Primera", nameEn: "Argentina Primera Division" },
    { id: "premier-league", nameTr: "Premier Lig", nameEn: "Premier League" },
    { id: "avrupa-ligi", nameTr: "Avrupa Ligi", nameEn: "Europa League" },
    { id: "bundesliga", nameTr: "Bundesliga", nameEn: "Bundesliga" },
    { id: "serie-a", nameTr: "Serie A", nameEn: "Serie A" },
    { id: "championship", nameTr: "Championship", nameEn: "Championship" }
  ];
  const ordered = orderLeagues(leagues);
  assert.deepEqual(ordered.slice(0, 7).map((item) => item.id), [...LEAGUE_PRIORITY]);
  const rest = ordered.slice(7).map((item) => item.nameTr);
  assert.deepEqual(rest, [...rest].sort((a, b) => a.localeCompare(b, "tr")));
  const weak = leagues.filter((item) => WEAK_LEAGUE_IDS.includes(item.id));
  for (const league of weak) {
    const inbound = ordered.filter((other) => relatedLeagues(ordered, other.id).some((item) => item.id === league.id));
    assert.ok(inbound.length >= 3, `${league.id} en az 3 kardeş ligden bağlanmalı, ${inbound.length}`);
  }
  console.log("  ok  lig sırası ve zayıf lig komşulukları");
}

{
  const links = selectTeamLinks({
    comparisons: Array.from({ length: 8 }, (_, index) => ({ href: `/karsilastirma/takimlar/a-vs-${index}`, label: `Takım A - Takım ${index} karşılaştırması` })),
    recent: [{ href: "/mac/son", label: "Takım A - Takım B maçı (1 Kasım 2026)" }],
    upcoming: [{ href: "/mac/sira", label: "Takım A - Takım C maçı (12 Kasım 2026)" }],
    files: [
      { href: "/mac-dosyasi/a", label: "Takım A maç dosyası" },
      { href: "/transfer", label: "Transferde son durum" },
      { href: "/mac-dosyasi/b", label: "İkinci maç dosyası" },
      { href: "/fazla", label: "Bu tavanın dışında kalmalı" }
    ],
    playerComparisons: Array.from({ length: 6 }, (_, index) => ({ href: `/karsilastirma/p-${index}`, label: `Oyuncu ${index} karşılaştırması` }))
  });
  assert.ok(links.length <= CAP.block, `blok tavanı ${CAP.block}, gelen ${links.length}`);
  assert.equal(new Set(links.map((item) => item.href)).size, links.length);
  assert.ok(links.some((item) => item.href === "/mac/son"));
  assert.ok(links.some((item) => item.href === "/mac/sira"));
  assert.ok(links.some((item) => item.href.startsWith("/mac-dosyasi/")));
  assert.ok(!links.some((item) => item.href === "/fazla"));
  assert.ok(links.filter((item) => item.href.startsWith("/karsilastirma/takimlar/")).length <= CAP.comparisons);
  console.log("  ok  takım bloğu tavanı ve çeşit");
}

{
  const articles = [
    { id: "a1", teamKey: "fenerbahce", publishedAt: "2026-08-02", title: "Ağustos başı" },
    { id: "a2", teamKey: "fenerbahce", publishedAt: "2026-08-20", title: "Ağustos sonu" },
    { id: "a3", teamKey: "fenerbahce", publishedAt: "2026-09-15", title: "Eylül" },
    { id: "b1", teamKey: "yalniz", publishedAt: "2026-08-10", title: "Tek haber" },
    { id: "c1", teamKey: "baska", publishedAt: "2026-09-01", title: "Komşu pencere" }
  ];
  const mid = selectNewsLinks(articles, articles[1]);
  assert.ok(mid.some((item) => item.id === "a1") && mid.some((item) => item.id === "a3"));
  assert.ok(mid.length <= CAP.news);
  const alone = selectNewsLinks(articles, articles[3]);
  assert.ok(alone.every((item) => isSummer2026(item)));
  assert.ok(alone.length >= 1);
  const hub = summerHubLinks(articles, 4);
  assert.ok(hub.length <= 4);
  assert.equal(hub[0].id, "a1");
  assert.equal(hub[hub.length - 1].id, "a3");
  console.log("  ok  haber komşuları ve yaz penceresi");
}

{
  const block = renderStrip({
    marker: "context-links",
    aria: "Galatasaray maçları",
    items: [
      { href: "/mac/a.html", label: "Galatasaray - Fenerbahçe maçı (19 Eylül 2026)", kicker: "Maç" },
      { href: "/karsilastirma/takimlar/a.html", label: "Galatasaray - Fenerbahçe karşılaştırması", kicker: "Karşılaştırma" }
    ]
  });
  assert.match(block, /data-context-links="context-links"/);
  assert.doesNotMatch(block, /display:\s*none|hidden|aria-hidden="true"/i);
  assert.doesNotMatch(block, />\s*(tıkla|buraya|click here|here)\s*</i);
  for (const label of [...block.matchAll(/<a href="[^"]+">([^<]+)<\/a>/g)].map((match) => match[1])) {
    assert.ok(label.length >= 12, label);
  }
  const html = upsertMarked("<main></main><footer></footer>", "context-links", block, "</main>", { placement: "before" });
  assert.ok(html.indexOf("context-links:start") < html.indexOf("</main>"));
  assert.equal(upsertMarked(html, "context-links", block, "</main>", { placement: "before" }), html);
  const en = renderStrip({
    aria: "Match links",
    items: [{ href: "/en/match/a.html", label: "Galatasaray vs Fenerbahce, 19 September 2026", kicker: "Match" }]
  });
  assert.equal(findTurkish(en.replace(/<[^>]+>/g, " "), { limit: 3 }).length, 0);
  console.log("  ok  görünür çapa, idempotent enjeksiyon, İngilizce etiket");
}

{
  assert.equal(normalizeHref("../lig/super-lig.html", "lig/avrupa-ligi.html"), "/lig/super-lig");
  assert.equal(normalizeHref("/mac/a.html?x=1#y", "index.html"), "/mac/a");
  assert.equal(normalizeHref("https://www.futbolradar.com/en/leagues.html", "index.html"), "/en/leagues");
  assert.equal(normalizeHref("https://example.com/mac/a.html", "index.html"), null);
  console.log("  ok  href normalizasyonu");
}

{
  const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const heroAt = home.indexOf('id="hero-canli-skor"');
  const newsAt = home.indexOf('id="futbol-gundemi"');
  const featuredAt = home.indexOf("data-featured-column");
  const columnsAt = home.indexOf('id="radar-yorumu"');
  const archiveAt = home.indexOf('id="arsiv-girisi"');
  const guideAt = home.indexOf("avrupa-ligi-eleme-sistemi-rehberi");
  assert.ok(heroAt >= 0 && newsAt > heroAt && featuredAt > newsAt && columnsAt > featuredAt && archiveAt > columnsAt, "ana sayfa sırası bozulmamalı");
  assert.ok(guideAt > heroAt && guideAt < columnsAt, "Avrupa Ligi rehberi futbol bölümünde, köşe yazılarının üstünde olmalı");
  const hub = fs.readFileSync(path.join(root, "ligler.html"), "utf8");
  const positions = ["sampiyonlar-ligi", "avrupa-ligi", "la-liga", "premier-league", "bundesliga", "serie-a", "ligue-1"].map((id) => hub.indexOf(`lig/${id}.html`));
  assert.ok(positions.every((at) => at >= 0), "lig merkezi öncelikli ligleri içermeli");
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  for (const id of WEAK_LEAGUE_IDS) assert.ok(hub.includes(`lig/${id}.html`), `lig merkezi ${id} içermeli`);
  const enHub = fs.readFileSync(path.join(root, "en/leagues.html"), "utf8");
  assert.equal(findTurkish(enHub.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " "), { limit: 5 }).length, 0, "İngilizce lig merkezi Türkçe metin içermemeli");
  const enOrder = ["champions-league-standings", "europa-league-standings", "la-liga-standings", "premier-league-standings", "bundesliga-standings", "serie-a-standings", "ligue-1-standings"].map((id) => enHub.indexOf(id));
  assert.ok(enOrder.every((at) => at >= 0));
  assert.deepEqual(enOrder, [...enOrder].sort((a, b) => a - b));
  console.log("  ok  ana sayfa sırası ve lig merkezleri");
}

{
  const targets = [
    "/avrupa-ligi-eleme-sistemi-rehberi.html",
    ...WEAK_LEAGUE_IDS.map((id) => `/lig/${id}.html`),
    "/en-iyi-forvetler.html",
    "/en-iyi-kaleciler.html",
    "/en-iyi-defanslar.html",
    "/en-iyi-orta-sahalar.html",
    "/en-iyi-super-lig-oyunculari.html",
    "/victor-osimhen-transfer-son-durum.html",
    "/mohamed-salah-trabzonspor-transfer-son-durum.html",
    "/dusan-vlahovic-besiktas-transfer-son-durum.html",
    "/turk-sporcu-sonuclari.html",
    "/karsilastirma/takimlar/galatasaray-vs-fenerbahce.html",
    "/mac-dosyasi/trabzonspor-galatasaray-mac-dosyasi.html",
    "/en/match-special/trabzonspor-galatasaray-match-special.html",
    "/ligler.html",
    "/en/leagues.html"
  ];
  const news = JSON.parse(fs.readFileSync(path.join(root, "data/news.json"), "utf8"));
  const summer = news.filter((item) => isSummer2026(item) && item.slug && fs.existsSync(path.join(root, "haber", `${item.slug}.html`)));
  const summerTargets = summer.map((item) => `/haber/${item.slug}.html`);
  const { counts, pagesScanned } = scanInbound(root, [...targets, ...summerTargets]);
  const inbound = (target) => counts[normalizeHref(target, "index.html")] || 0;
  console.log(`  ..  ${pagesScanned} sayfa tarandı`);
  assert.ok(inbound("/avrupa-ligi-eleme-sistemi-rehberi.html") >= 4, `rehber inbound ${inbound("/avrupa-ligi-eleme-sistemi-rehberi.html")}`);
  for (const id of WEAK_LEAGUE_IDS) {
    const count = inbound(`/lig/${id}.html`);
    assert.ok(count >= 4, `${id} inbound ${count}`);
  }
  for (const file of ["en-iyi-forvetler.html", "en-iyi-kaleciler.html", "en-iyi-defanslar.html", "en-iyi-orta-sahalar.html", "en-iyi-super-lig-oyunculari.html"]) {
    assert.ok(inbound(`/${file}`) >= 2, `${file} inbound ${inbound(`/${file}`)}`);
  }
  for (const file of ["victor-osimhen-transfer-son-durum.html", "mohamed-salah-trabzonspor-transfer-son-durum.html", "dusan-vlahovic-besiktas-transfer-son-durum.html"]) {
    assert.ok(inbound(`/${file}`) >= 2, `${file} inbound ${inbound(`/${file}`)}`);
  }
  assert.ok(inbound("/turk-sporcu-sonuclari.html") >= 2, `turk-sporcu inbound ${inbound("/turk-sporcu-sonuclari.html")}`);
  assert.ok(inbound("/karsilastirma/takimlar/galatasaray-vs-fenerbahce.html") >= 2);
  assert.ok(inbound("/mac-dosyasi/trabzonspor-galatasaray-mac-dosyasi.html") >= 2);
  assert.ok(inbound("/en/match-special/trabzonspor-galatasaray-match-special.html") >= 2);
  assert.ok(inbound("/ligler.html") >= 2);
  assert.ok(inbound("/en/leagues.html") >= 2);
  const strong = summerTargets.filter((target) => inbound(target) >= 2).length;
  assert.ok(summer.length > 10, `yaz haberi az: ${summer.length}`);
  assert.ok(strong / summer.length >= 0.8, `yaz haberlerinin %80'i en az 2 inbound almalı (${strong}/${summer.length})`);
  const gs = fs.readFileSync(path.join(root, "takimlar/galatasaray.html"), "utf8");
  assert.match(gs, /karsilastirma\/takimlar\/galatasaray-vs-/);
  assert.match(gs, /\/mac\/|mac\//);
  assert.match(gs, /mac-dosyasi\//);
  const enTeam = fs.readFileSync(path.join(root, "en/team/galatasaray.html"), "utf8");
  assert.match(enTeam, /en\/match\//);
  assert.doesNotMatch(enTeam, /karsilastirma\/takimlar\//);
  assert.equal(findTurkish(enTeam.slice(enTeam.indexOf("context-links:start"), enTeam.indexOf("context-links:end")), { limit: 3 }).length, 0);
  const derby = fs.readFileSync(path.join(root, "mac/trabzonspor-galatasaray-19-eylul-2026.html"), "utf8");
  assert.match(derby, /takimlar\/trabzonspor|trabzonspor-maclari/);
  assert.match(derby, /takimlar\/galatasaray|galatasaray-maclari/);
  assert.match(derby, /lig\/super-lig/);
  assert.match(derby, /karsilastirma\/takimlar\/galatasaray-vs-trabzonspor|karsilastirma\/takimlar\/trabzonspor-vs-galatasaray/);
  console.log(`  ok  kilit sayfalar inbound (yaz haber ${strong}/${summer.length})`);
}

console.log("link-graph: tamam");
