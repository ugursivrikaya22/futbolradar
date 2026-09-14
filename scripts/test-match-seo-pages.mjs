#!/usr/bin/env node
/**
 * MAÇ SEO SAYFALARI — SÖZLEŞME DENETİMİ.
 *
 * İki katman:
 *   1. SAF KURALLAR (sentetik veri): slug/URL kalıcılığı, indeks kuralı,
 *      sayfa hâli (maç öncesi / canlı / bitmiş / sonuç bekleyen / iptal),
 *      olay normalizasyonu, "kanal bilinmiyor" ve "kadro yok" dürüst çıktıları.
 *   2. ÜRETİLMİŞ AĞAÇ (mac/, en/match/, sitemap.xml, data/match-seo-*.json):
 *      canonical, hreflang, SportsEvent şeması, tek H1, mobil güvenlik
 *      (sabit genişlik yok), sitemap girdileri ve rota haritası çiftleri.
 *
 * Senaryolar (istek listesi): A gelecek maç, B canlı maç, C bitmiş maç,
 * D kanalı bilinmeyen maç, E kadrosu olmayan maç, F mobil görünüm,
 * G Googlebot HTML'i (SSR), H canonical, I SportsEvent şeması, J sitemap.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  STR,
  heroHtml,
  lineupsSectionHtml,
  normalizeEvents,
  statsTableHtml,
  whenSectionHtml
} from "./lib/matchSeoPage.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const seo = require("../services/matchSeoPages.js");
const { dynamicRoutePairs } = require("../services/i18n.js");

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
}

console.log("match-seo-pages");

// ── 1. Slug ve adres kuralı ───────────────────────────────────────────────
check("TR/EN slug: takım + gün + ay + yıl, Türkiye saatine göre", () => {
  assert.equal(seo.trSlugFor("Fenerbahçe", "Beşiktaş", "2026-09-05T20:00:00+03:00"), "fenerbahce-besiktas-5-eylul-2026");
  assert.equal(seo.enSlugFor("Fenerbahçe", "Beşiktaş", "2026-09-05T20:00:00+03:00"), "fenerbahce-besiktas-september-5-2026");
  // UTC 22:30 = TSİ 01:30 ertesi gün: slug TSİ gününü izler.
  assert.equal(seo.trSlugFor("Galatasaray", "Trabzonspor", "2026-09-05T22:30:00Z"), "galatasaray-trabzonspor-6-eylul-2026");
  assert.equal(seo.trSlugFor("A", "B", null), null);
});

check("kanonik adres uzantısızdır ve dosya yolu .html ile biter", () => {
  assert.equal(seo.trPageUrl("fenerbahce-besiktas-5-eylul-2026"), "https://www.futbolradar.com/mac/fenerbahce-besiktas-5-eylul-2026");
  assert.equal(seo.trPagePath("fenerbahce-besiktas-5-eylul-2026"), "mac/fenerbahce-besiktas-5-eylul-2026.html");
  assert.equal(seo.enPageUrl("fenerbahce-besiktas-september-5-2026"), "https://www.futbolradar.com/en/match/fenerbahce-besiktas-september-5-2026");
});

check("kulüp adı kanonikleşir: sağlayıcı 'Rizespor' ile TFF 'Çaykur Rizespor' aynı slug", () => {
  assert.equal(seo.trSlugFor("Rizespor", "Alanyaspor", "2026-09-07T20:00:00+03:00"), seo.trSlugFor("Çaykur Rizespor", "Alanyaspor", "2026-09-07T20:00:00+03:00"));
  assert.equal(seo.identityOf({ homeTeam: "Rizespor", awayTeam: "Alanyaspor", kickoff: "2026-09-07T20:00:00+03:00" }), "caykur-rizespor|alanyaspor|2026-09-07");
});

// ── 2. İndeks kuralı ──────────────────────────────────────────────────────
check("yalnızca öncelikli yarışmalar ve Türkiye millî maçları sicile girer", () => {
  assert.equal(seo.evaluateEligibility({ homeTeam: "A", awayTeam: "B", kickoff: "2026-09-05T20:00:00+03:00", competitionId: "super-lig", league: "Süper Lig" }).eligible, true);
  assert.equal(seo.evaluateEligibility({ homeTeam: "A", awayTeam: "B", kickoff: "2026-09-05T20:00:00+03:00", competitionId: "championship", league: "Championship" }).eligible, false);
  assert.equal(seo.evaluateEligibility({ homeTeam: "A", awayTeam: "B", kickoff: "2026-09-05T20:00:00+03:00", league: "Hazırlık Maçı", competitionId: "hazirlik-maci" }).eligible, false);
  assert.equal(seo.evaluateEligibility({ homeTeam: "A", awayTeam: "B", competitionId: "super-lig" }).reason, "missing-kickoff");
  assert.equal(seo.evaluateEligibility({ homeTeam: "Türkiye", awayTeam: "İspanya", kickoff: "2026-10-10T21:45:00+03:00", league: "UEFA Nations League" }).reason, "national-team");
  assert.equal(seo.evaluateEligibility({ homeTeam: "A", awayTeam: "B", kickoff: "2026-09-05T20:00:00+03:00", league: "Premier League", providerLeagueId: "39" }).competitionId, "premier-league");
});

// ── 3. Sayfa hâli ─────────────────────────────────────────────────────────
const NOW = Date.parse("2026-09-05T20:30:00+03:00");
check("A) gelecekteki maç → pre; B) canlı skorlu → live; C) bitmiş → post", () => {
  assert.equal(seo.pageStateOf({ status: "SCHEDULED", kickoff: "2026-09-07T20:00:00+03:00", score: { home: null, away: null } }, NOW), "pre");
  assert.equal(seo.pageStateOf({ status: "LIVE", providerStatus: "2H", minute: 62, kickoff: "2026-09-05T20:00:00+03:00", score: { home: 1, away: 0 } }, NOW), "live");
  assert.equal(seo.pageStateOf({ status: "FINISHED", providerStatus: "FT", kickoff: "2026-09-05T17:00:00+03:00", score: { home: 2, away: 1 } }, NOW), "post");
});

check("skorsuz canlı iddiası ve bayat canlı kaydı 'canlı' sayılmaz", () => {
  assert.equal(seo.pageStateOf({ status: "LIVE", kickoff: "2026-09-05T20:00:00+03:00", score: { home: null, away: null } }, NOW), "pre");
  assert.equal(seo.pageStateOf({ status: "LIVE", kickoff: "2026-09-05T14:00:00+03:00", score: { home: 1, away: 1 } }, NOW), "pending");
  assert.equal(seo.pageStateOf({ status: "SCHEDULED", kickoff: "2026-09-04T20:00:00+03:00", score: { home: null, away: null } }, NOW), "pending");
});

check("iptal ve erteleme: sayfa kalır, indekslenmez", () => {
  const cancelled = { slug: "x", homeTeam: "A", awayTeam: "B", status: "CANCELLED", kickoff: "2026-09-07T20:00:00+03:00", score: { home: null, away: null } };
  assert.equal(seo.pageStateOf(cancelled, NOW), "cancelled");
  assert.equal(seo.isIndexableEntry(cancelled, NOW), false);
  assert.equal(seo.isIndexableEntry({ ...cancelled, status: "POSTPONED" }, NOW), false);
  assert.equal(seo.isIndexableEntry({ ...cancelled, status: "SCHEDULED" }, NOW), true);
});

// ── 4. Dürüst boş durumlar ────────────────────────────────────────────────
const baseCtx = (locale) => ({ locale, base: "../", state: "pre", playerIndex: { find: () => null }, homeTeam: "Fenerbahçe", awayTeam: "Beşiktaş", homeHref: null, awayHref: null, homeLogo: null, awayLogo: null, competitionName: "Süper Lig", roundLabel: "4. Hafta" });

check("D) yayın kanalı bilinmiyor → 'Henüz açıklanmadı', kanal tahmini yok", () => {
  const entry = { homeTeam: "Fenerbahçe", awayTeam: "Beşiktaş", kickoff: "2026-09-05T20:00:00+03:00", venue: "Chobani Stadyumu", referee: null, broadcast: null, score: { home: null, away: null } };
  const hero = heroHtml(entry, baseCtx("tr"));
  assert.ok(hero.includes("Henüz açıklanmadı"), "kanal ve hakem satırı dürüst boş ifade taşımalı");
  const faq = whenSectionHtml(entry, baseCtx("tr"));
  assert.ok(faq.includes("hangi kanalda?") && faq.includes("yayın kanalı henüz açıklanmadı"));
  assert.ok(!/beIN|TRT|S Sport|Tivibu/.test(faq), "kanal adı uydurulmamalı");
  const withChannel = whenSectionHtml({ ...entry, broadcast: { turkey: "beIN Sports 1" } }, baseCtx("tr"));
  assert.ok(withChannel.includes("beIN Sports 1 ekranlarından"));
  const en = heroHtml(entry, baseCtx("en"));
  assert.ok(en.includes("Not announced yet"));
});

check("E) kadro bilgisi yok → 'Kadrolar açıklandığında' notu, boş kutu değil", () => {
  const html = lineupsSectionHtml({ lineups: [] }, null, baseCtx("tr"));
  assert.ok(html.includes("Kadrolar açıklandığında burada yayımlanır"));
  assert.ok(!html.includes("<ol"), "oyuncu listesi çizilmemeli");
  const official = lineupsSectionHtml({ lineups: [
    { team: "Fenerbahçe", formation: "4-2-3-1", players: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"], substitutes: ["L"] },
    { team: "Beşiktaş", formation: "4-3-3", players: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"], substitutes: [] }
  ] }, null, baseCtx("tr"));
  assert.ok(official.includes("İlk 11") && official.includes("4-2-3-1") && (official.match(/<ol class="msp-lineup-list">/g) || []).length === 2);
  assert.ok(official.includes('id="kadrolar"') && official.includes('id="muhtemel-11"'), "eski kadro bağlantıları resmî ilk 11 açıklandığında korunmalı");
  for (const locale of ["tr", "en"]) {
    for (const state of ["post", "pending"]) {
      const unavailable = lineupsSectionHtml({ lineups: [] }, null, { ...baseCtx(locale), state });
      assert.ok(unavailable.includes('id="muhtemel-11"'), "maç sonrası kadro hedefi kaybolmamalı");
      assert.ok(!unavailable.includes("<ol") && !unavailable.includes("is-probable"), "veri yokken oyuncu veya tahmin yazılmamalı");
      assert.ok(unavailable.includes(locale === "tr" ? "verisi mevcut değil" : "not available"), "veri eksikliği açıkça belirtilmeli");
    }
  }
});

check("olay normalizasyonu: sağlayıcı ve editoryal kayıtlar tek biçime iner", () => {
  const events = normalizeEvents({ events: [
    { time: "45+2'", team: { name: "Fenerbahçe" }, type: "Goal", detail: "Penalty", value: "Talisca · Penalty" },
    { time: "46'", team: { name: "Beşiktaş" }, type: "subst", detail: "Substitution 1", value: "In · Asist: Out · Substitution 1" },
    { time: "70'", team: { name: "Beşiktaş" }, type: "Card", detail: "Red Card", value: "X · Red Card" },
    { time: "80'", team: { name: "Fenerbahçe" }, type: "Var", detail: "Goal cancelled", value: "Y · Goal cancelled" }
  ], substitutions: [{ time: "60'", team: "Fenerbahçe", in: "Giren", out: "Çıkan" }] }, "Fenerbahçe", "Beşiktaş");
  assert.deepEqual(events.map((event) => event.kind), ["penalty", "sub", "sub", "red", "var"]);
  assert.equal(events[0].side, "home");
  assert.equal(events[1].playerIn, "In");
  assert.equal(events[1].playerOut, "Out");
  assert.equal(events[2].playerIn, "Giren");
});

check("istatistik tablosu yalnızca iki taraflı satırları çizer; sahte yedek satır yok", () => {
  const html = statsTableHtml([
    { category: "Genel", type: "Topla oynama", home: 58, away: 42, unit: "%" },
    { team: "Fenerbahçe", type: "Momentum", value: 70 }
  ], "tr", "Fenerbahçe", "Beşiktaş");
  assert.ok(html.includes("Topla oynama") && html.includes("58%"));
  assert.ok(!html.includes("Momentum"));
  assert.equal(statsTableHtml([], "tr", "A", "B"), "");
});

check("hero: bitmiş maçta skor, ilk yarı ve durum; maç öncesinde saat", () => {
  const post = heroHtml({ homeTeam: "Fenerbahçe", awayTeam: "Beşiktaş", kickoff: "2026-09-05T20:00:00+03:00", status: "FINISHED", providerStatus: "FT", score: { home: 2, away: 1, halftimeHome: 1, halftimeAway: 0 } }, { ...baseCtx("tr"), state: "post" });
  assert.ok(post.includes('data-msp-score-home>2<') && post.includes('data-msp-score-away>1<'));
  assert.ok(post.includes("İlk yarı: 1-0") && post.includes("Tamamlandı"));
  const pre = heroHtml({ homeTeam: "Fenerbahçe", awayTeam: "Beşiktaş", kickoff: "2026-09-05T20:00:00+03:00", status: "SCHEDULED", score: { home: null, away: null } }, baseCtx("tr"));
  assert.ok(pre.includes('data-msp-score-home>20:00<') && pre.includes("Başlamadı"));
  const live = heroHtml({ homeTeam: "Fenerbahçe", awayTeam: "Beşiktaş", kickoff: "2026-09-05T20:00:00+03:00", status: "LIVE", providerStatus: "2H", minute: 62, score: { home: 1, away: 0 } }, { ...baseCtx("tr"), state: "live" });
  assert.ok(live.includes("62&#039;") && live.includes("live-pulse"));
});

// ── 5. Üretilmiş ağaç ─────────────────────────────────────────────────────
const registry = seo.loadRegistry();
const pages = registry.pages;
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const pick = (html, expression) => { const found = html.match(expression); return found ? found[1] : ""; };

check("sicil dolu ve her kayıt kalıcı slug + EN slug taşıyor", () => {
  assert.ok(pages.length > 0, "sicil boş");
  for (const entry of pages) {
    assert.ok(entry.slug && entry.enSlug && entry.kickoff && entry.homeTeam && entry.awayTeam, `eksik alan: ${JSON.stringify(entry).slice(0, 120)}`);
    assert.ok(fs.existsSync(path.join(root, seo.trPagePath(entry.slug))), `TR sayfa yok: ${entry.slug}`);
    assert.ok(fs.existsSync(path.join(root, seo.enPagePath(entry.enSlug))), `EN sayfa yok: ${entry.enSlug}`);
  }
  assert.equal(new Set(pages.map((entry) => entry.slug)).size, pages.length, "slug çakışması");
});

check("çalışma zamanı dizini sağlayıcı kimliğinden ve kimlikten slug bulur", () => {
  const index = seo.buildIndex(registry);
  const withProvider = pages.find((entry) => entry.providerIds && entry.providerIds.apiFootball);
  assert.ok(withProvider, "sağlayıcı kimliği taşıyan kayıt bekleniyor");
  assert.equal(seo.slugForMatch({ providerIds: { apiFootball: withProvider.providerIds.apiFootball } }, index), withProvider.slug);
  assert.equal(seo.slugForMatch({ homeTeam: withProvider.homeTeam, awayTeam: withProvider.awayTeam, kickoff: withProvider.kickoff }, index), withProvider.slug);
  const stamped = seo.withMatchPages([{ homeTeam: withProvider.homeTeam, awayTeam: withProvider.awayTeam, kickoff: withProvider.kickoff, league: "x" }], index);
  assert.equal(stamped[0].matchPage, `mac/${withProvider.slug}`);
  assert.equal(stamped[0].analysisPage, undefined, "analysisPage'e yazılmaz: rapor üreticisi o yola dosya basar");
});

const sitemap = fs.existsSync(path.join(root, "sitemap.xml")) ? read("sitemap.xml") : "";
const sample = (list, size) => { if (list.length <= size) return list; const step = Math.floor(list.length / size); return list.filter((_, index) => index % step === 0).slice(0, size); };

check("G/H/I) Googlebot'un aldığı SSR HTML: canonical kendini gösterir, tek H1, SportsEvent + BreadcrumbList, hreflang çifti", () => {
  for (const entry of sample(pages, 24)) {
    for (const [locale, relative, canonical] of [["tr", seo.trPagePath(entry.slug), seo.trPageUrl(entry.slug)], ["en", seo.enPagePath(entry.enSlug), seo.enPageUrl(entry.enSlug)]]) {
      const html = read(relative);
      assert.equal(pick(html, /<link rel="canonical" href="([^"]+)"/), canonical, `${relative}: canonical`);
      assert.equal(pick(html, /<meta property="og:url" content="([^"]+)"/), canonical, `${relative}: og:url`);
      assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${relative}: tek H1`);
      assert.ok(html.includes(`<html lang="${locale}">`), `${relative}: lang`);
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
      const graph = blocks.flatMap((block) => (block["@graph"] ? block["@graph"] : [block]));
      const event = graph.find((node) => node["@type"] === "SportsEvent");
      assert.ok(event, `${relative}: SportsEvent yok`);
      assert.match(event.startDate, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+03:00$/, `${relative}: startDate TSİ ofsetli olmalı`);
      assert.equal(event.url, canonical);
      assert.equal(event.homeTeam.name, entry.homeTeam);
      assert.equal(event.awayTeam.name, entry.awayTeam);
      assert.equal(event.competitor.length, 2);
      if (event.location) assert.equal(event.location.name, entry.venue, `${relative}: location uydurulmamalı`);
      assert.ok(graph.some((node) => node["@type"] === "BreadcrumbList"), `${relative}: BreadcrumbList`);
      assert.ok(html.includes(`hreflang="tr-TR" href="${seo.trPageUrl(entry.slug)}"`) && html.includes(`hreflang="en" href="${seo.enPageUrl(entry.enSlug)}"`), `${relative}: hreflang çifti`);
      // Skor SSR'da yazılıysa şemada UYDURMA canlı durum yok, hâl HTML'den okunur.
      assert.ok(html.includes("data-match-center"), `${relative}: canlı merkez kancası`);
      assert.ok(html.includes("match-center.js"), `${relative}: canlı istemci`);
      assert.ok(!html.includes('src="../app.js"') && !html.includes('src="../../app.js"'), `${relative}: tam app.js yüklenmemeli`);
      const state = pick(html, /data-msp-state="([a-z]+)"/);
      const title = pick(html, /<title>([^<]+)<\/title>/);
      if (state === "post") assert.match(title, /\d+-\d+/, `${relative}: bitmiş maç başlığı skor taşımalı`);
      if (state === "pre" && locale === "tr") assert.match(title, /Ne Zaman, Saat Kaçta, Hangi Kanalda/, `${relative}: maç öncesi başlık`);
      if (state === "pre" && locale === "en") assert.match(title, /Kick-off Time/, `${relative}: EN maç öncesi başlık`);
      if (state === "live") assert.match(title, /Canlı Skor|Live Score/, `${relative}: canlı başlık`);
    }
  }
});

check("F) mobil güvenlik: sabit piksel genişlik yok, armalar boyutlu (CLS yok), viewport var", () => {
  for (const entry of sample(pages, 12)) {
    const html = read(seo.trPagePath(entry.slug));
    assert.ok(html.includes('name="viewport" content="width=device-width, initial-scale=1"'));
    assert.ok(!/style="[^"]*width:\s*\d{3,}px/.test(html), "gövdede üç haneli sabit px genişlik olmamalı");
    for (const img of html.matchAll(/<img class="msp-badge"[^>]*>/g)) {
      assert.ok(/width="\d+"/.test(img[0]) && /height="\d+"/.test(img[0]) && /loading="(lazy|eager)"/.test(img[0]), "arma boyut ve loading taşımalı");
    }
    assert.ok(html.includes('class="msp-scoreboard"'), "skor tablosu en üstte");
  }
});

check("J) sitemap: indekslenebilir her maç sayfası (TR+EN) alternate ve tarihli lastmod ile listeli; iptal edilen listede değil", () => {
  assert.ok(sitemap, "sitemap.xml yok");
  for (const entry of pages) {
    const trUrl = seo.trPageUrl(entry.slug);
    const listed = sitemap.includes(`<loc>${trUrl}</loc>`);
    if (seo.isIndexableEntry(entry)) {
      assert.ok(listed, `sitemap'te yok: ${trUrl}`);
      assert.ok(sitemap.includes(`<loc>${seo.enPageUrl(entry.enSlug)}</loc>`), `EN sitemap'te yok: ${entry.enSlug}`);
    } else {
      assert.ok(!listed, `indekslenmeyen sayfa sitemap'te: ${trUrl}`);
    }
  }
  const block = sitemap.slice(sitemap.indexOf(`<loc>${seo.trPageUrl(pages[0].slug)}</loc>`));
  const entryBlock = block.slice(0, block.indexOf("</url>"));
  assert.match(entryBlock, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  assert.ok(entryBlock.includes('hreflang="en"') && entryBlock.includes('hreflang="x-default"'));
  assert.ok(sitemap.includes("<loc>https://www.futbolradar.com/mac-takvimi</loc>") && sitemap.includes("<loc>https://www.futbolradar.com/en/matches</loc>"), "hub sayfaları sitemap'te");
});

check("rota haritası: her maç için TR↔EN çifti uzantısız kanonik adreslerle kayıtlı", () => {
  const rows = dynamicRoutePairs("match-seo");
  assert.equal(rows.length, pages.length);
  const first = rows.find((row) => row.tr === seo.trPagePath(pages[0].slug));
  assert.ok(first && first.trUrl === seo.trPageUrl(pages[0].slug) && first.enUrl === seo.enPageUrl(pages[0].enSlug));
  assert.ok(dynamicRoutePairs("match-seo-hub").some((row) => row.tr === "mac-takvimi.html" && row.en === "en/matches.html"));
});

check("hub ve ay sayfaları var ve her indekslenebilir maça bağlantı veriyor (yetim sayfa yok)", () => {
  const hub = read("mac-takvimi.html");
  assert.ok(hub.includes("<h1>") && hub.includes("mac-takvimi/"));
  const linked = new Set();
  for (const file of fs.readdirSync(path.join(root, "mac-takvimi"))) {
    for (const match of read(`mac-takvimi/${file}`).matchAll(/href="\.\.\/mac\/([^"]+)"/g)) linked.add(match[1]);
  }
  for (const match of hub.matchAll(/href="\.\/mac\/([^"]+)"/g)) linked.add(match[1]);
  for (const entry of pages) {
    if (!seo.isIndexableEntry(entry)) continue;
    assert.ok(linked.has(entry.slug), `hub/ay sayfalarından bağlanmayan maç: ${entry.slug}`);
  }
});

check("hub: 'Yaklaşan maçlar' bitmiş/sonuç bekleyen maç göstermiyor, 'Son sonuçlar' henüz oynanmamış maç göstermiyor", () => {
  const hub = read("mac-takvimi.html");
  const between = (html, startMarker, endMarker) => {
    const start = html.indexOf(startMarker);
    if (start === -1) return "";
    const end = html.indexOf(endMarker, start);
    return html.slice(start, end === -1 ? html.length : end);
  };
  // Aynı gün bitmiş bir maç, saat ilerledikçe "post"/"pending" durumuna geçer;
  // yalnızca gün aralığına bakan bir süzgeç bunu "Yaklaşan maçlar" başlığı
  // altında final skoruyla bırakır. Durum sınıfı (`is-post`/`is-pending`)
  // satıra basıldığı için bölüm bazında doğrulanabilir.
  const upcomingSection = between(hub, "Yaklaşan maçlar", "Son sonuçlar");
  assert.ok(!/is-post"|is-pending"/.test(upcomingSection), "'Yaklaşan maçlar' bölümünde bitmiş/sonuç bekleyen bir maç satırı var");
  const recentSection = between(hub, "Son sonuçlar", "Aylara göre maç arşivi");
  assert.ok(!/is-pre"/.test(recentSection), "'Son sonuçlar' bölümünde henüz oynanmamış bir maç satırı var");
});

check("vercel.json: temiz adres rewrite'ları var", () => {
  const vercel = JSON.parse(read("vercel.json"));
  for (const source of ["/mac/:slug", "/en/match/:slug", "/mac-takvimi", "/mac-takvimi/:slug", "/en/matches", "/en/matches/:slug"]) {
    assert.ok(vercel.rewrites.some((rule) => rule.source === source), `rewrite eksik: ${source}`);
  }
});

check("eski hafta numaralı sayfalar kalıcı sayfaya bağlanıyor ve silinmiyor", () => {
  const roundPages = fs.readdirSync(path.join(root, "mac")).filter((file) => /-r\d{2}\.html$/.test(file));
  assert.ok(roundPages.length > 0);
  const dated = fs.readdirSync(path.join(root, "mac")).filter((file) => !/-r\d{2}\.html$/.test(file) && file.endsWith(".html"));
  assert.equal(dated.length, pages.length, "tarih slug'lı dosya sayısı sicille eşit olmalı");
  const linkedRound = roundPages.filter((file) => read(`mac/${file}`).includes("Canlı maç merkezi"));
  assert.ok(linkedRound.length > 0, "tarihi onaylı en az bir hafta sayfası kalıcı sayfaya bağlanmalı");
});

/**
 * TEK MAÇ = TEK KANONİK ADRES.
 *
 * Hafta numaralı sayfa (tarih atanmadan önce üretilen takma ad) ile kalıcı
 * Maç Merkezi sayfası aynı maçı anlatır. Maçın tarihi onaylanıp Maç Merkezi
 * açıldığı anda hafta sayfası kanonikliği DEVRETMEK ZORUNDA: aksi hâlde aynı
 * maç iki indekslenebilir adreste yarışır ve site haritası ikisini de bildirir.
 */
check("devredilmiş hafta sayfası kanoniği Maç Merkezi'ni gösterir ve haritadan düşer", () => {
  const slugOf = (file) => file.replace(/\.html$/, "");
  const sitemap = read("sitemap.xml");
  let aliased = 0;

  for (const [dir, prefix] of [["mac", "mac"], ["en/match", "en/match"]]) {
    for (const file of fs.readdirSync(path.join(root, dir)).filter((name) => /-r\d{2}\.html$/.test(name))) {
      const html = read(`${dir}/${file}`);
      const canonical = (html.match(/rel="canonical" href="([^"]+)"/) || [])[1];
      assert.ok(canonical, `${dir}/${file}: canonical yok`);

      const selfUrl = `${seo.DOMAIN}/${prefix}/${slugOf(file)}.html`;
      if (canonical === selfUrl) {
        // Tarihi henüz atanmamış eşleşme: kendi adresi kanonik kalır.
        assert.ok(sitemap.includes(`<loc>${selfUrl}</loc>`), `${dir}/${file}: kanonik sayfa haritada olmalı`);
        continue;
      }

      aliased += 1;
      // Takma ad: kanonik hedef GERÇEKTEN var olmalı (404'e canonical verilmez).
      const target = canonical.replace(`${seo.DOMAIN}/`, "");
      const targetFile = target.endsWith(".html") ? target : `${target}.html`;
      assert.ok(fs.existsSync(path.join(root, targetFile)), `${dir}/${file}: kanonik hedef yok → ${targetFile}`);
      // Takma ad site haritasında kendi adresiyle YER ALMAZ.
      assert.ok(!sitemap.includes(`<loc>${selfUrl}</loc>`), `${dir}/${file}: takma ad haritadan düşmeli`);
      // Aynı olay için ikinci bir SportsEvent düğümü bırakılmaz.
      assert.ok(!html.includes("SportsEvent"), `${dir}/${file}: takma adda SportsEvent kalmamalı`);
      // Kullanıcı da devri görmeli.
      assert.ok(html.includes("match-centre-handoff"), `${dir}/${file}: devir şeridi yok`);
    }
  }

  assert.ok(aliased > 0, "tarihi onaylı en az bir hafta sayfası Maç Merkezi'ne devredilmiş olmalı");
});

if (process.exitCode) {
  console.error("match-seo-pages: FAILED");
} else {
  console.log(`match-seo-pages: ${passed} denetim geçti.`);
}
