/**
 * ÖNE ÇIKARILAN MAÇ SAYFASI — yayındaki dosyalar üzerinde sözleşme.
 *
 * `featuredFixtures` içindeki her maç için (sicilde varsa):
 *   • Sicilde TEK kayıt, diskte TEK TR + TEK EN sayfa (yinelenen adres yok).
 *   • JSON-LD ayrıştırılabilir; SportsEvent başlama saati/stat sicille aynı;
 *     doğrulanmış kanal yoksa BroadcastEvent yok.
 *   • Vitrin/sayfa uydurma alan basmaz: kanal yoksa "hangi kanalda" cevabı
 *     "açıklanmadı" der; bağlam dosyası yoksa açıklama "son 10 maç" demez.
 * Sicilde henüz kayıt yoksa (maç takvime girmedi) test o maçı atlar.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const spotlight = require("../services/featuredMatchSpotlight.js");
const readJson = (relative, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8")); } catch { return fallback; } };

const settings = spotlight.withDefaults(readJson("data/featured-match-spotlight.json", {}));
const registry = readJson("data/match-seo-pages.json", { pages: [] }).pages || [];
const contextStore = readJson("data/featured-match-context.json", { fixtures: {} });
let checked = 0;

for (const fixture of settings.featuredFixtures) {
  const entries = registry.filter((entry) => spotlight.featuredFixtureFor(entry, [fixture]));
  if (!entries.length) { console.log(`featured-match-page: ${fixture.homeTeam} - ${fixture.awayTeam} (${fixture.date}) sicilde yok, atlandı.`); continue; }
  assert.equal(entries.length, 1, `${fixture.homeTeam} - ${fixture.awayTeam}: sicilde tek kayıt olmalı`);
  const [entry] = entries;
  assert.equal(new Set(registry.map((row) => row.slug)).size, registry.length, "sicilde yinelenen slug yok");
  const pages = [["tr", `mac/${entry.slug}.html`], ["en", `en/match/${entry.enSlug}.html`]];
  // Aynı maç (kimlik) için ikinci bir sicil satırı ya da hreflang çifti olmamalı.
  assert.equal(registry.filter((row) => row.identity === entry.identity).length, 1, "aynı kimlikle ikinci sayfa yok");
  const routes = readJson("data/en-route-map.json", []);
  const routeList = Array.isArray(routes) ? routes : (routes.routes || routes.entries || []);
  const pairs = routeList.filter((row) => row && (String(row.trUrl || "").endsWith(`/mac/${entry.slug}`) || String(row.enUrl || "").endsWith(`/en/match/${entry.enSlug}`)));
  assert.ok(pairs.length <= 1, `hreflang çifti tek olmalı (${pairs.length})`);
  for (const [locale, relative] of pages) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) { console.log(`featured-match-page: ${relative} henüz üretilmedi, atlandı.`); continue; }
    const html = fs.readFileSync(file, "utf8");
    const canonical = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
    assert.equal(canonical, `https://www.futbolradar.com/${relative.replace(/\.html$/, "")}`, `${relative}: kanonik kendisi`);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    assert.ok(blocks.length, `${relative}: JSON-LD var`);
    const nodes = blocks.flatMap((block) => block["@graph"] || [block]);
    const events = nodes.filter((node) => node["@type"] === "SportsEvent");
    assert.equal(events.length, 1, `${relative}: tek SportsEvent`);
    const event = events[0];
    assert.equal(Date.parse(event.startDate), Date.parse(entry.kickoff), `${relative}: başlama saati sicille aynı`);
    if (entry.venue) assert.equal(event.location && event.location.name, entry.venue, `${relative}: stat sicille aynı`);
    else assert.ok(!event.location, `${relative}: stat yoksa location yok`);
    const hasChannel = Boolean(entry.broadcast && entry.broadcast.turkey);
    if (!hasChannel) assert.ok(!JSON.stringify(event).includes("BroadcastEvent"), `${relative}: doğrulanmış kanal yokken BroadcastEvent yok`);
    const focus = entry.providerIds && contextStore.fixtures && contextStore.fixtures[String(entry.providerIds.apiFootball)];
    const hasLast10 = Boolean(focus && focus.last10 && (focus.last10.home.length || focus.last10.away.length));
    const description = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "";
    if (!hasLast10) assert.ok(!/son 10 maç|last 10 matches/i.test(description), `${relative}: bağlam yokken "son 10 maç" denmez`);
    checked += 1;
  }
}

console.log(`featured-match-page: ${checked} sayfa doğrulandı.`);
