#!/usr/bin/env node
// El Clásico SEO sayfası: kaynak zorunluluğu, bölüm atlama, noindex, JSON-LD ve mobil kurallar.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderElClasico, EL_CLASICO_SLUG } from "./generate-el-clasico-page.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(fs.readFileSync(path.join(root, "data", "el-clasico.json"), "utf8"));
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// 1) Her kaynaklı kayıtta sourceUrl var.
for (const f of data.fixtures) { ok(/^https:\/\//.test(f.sourceUrl), `fixture sourceUrl: ${f.kickoff}`); if (f.broadcast) ok(/^https:\/\//.test(f.broadcast.sourceUrl), "broadcast sourceUrl"); }
ok(/^https:\/\//.test(data.headToHead.sourceUrl) && data.headToHead.asOf, "h2h kaynak + tarih");
const t = data.headToHead.total; ok(t.barcelonaWins + t.realMadridWins + t.draws === t.played, "h2h toplamı tutarlı");

// 2) Maç öncesi: tam sayfa, index.
const standings = { "la-liga": { updatedAt: "2026-10-19T06:07:22Z", table: [
  { team: "Barcelona", rank: 1, played: 9, won: 9, drawn: 0, lost: 0, goalsFor: 39, goalsAgainst: 9, points: 27, form: ["W"], source: "api-football" },
  { team: "Real Madrid", rank: 3, played: 9, won: 7, drawn: 0, lost: 2, goalsFor: 23, goalsAgainst: 9, points: 21, form: ["L"], source: "api-football" }] } };
const pre = renderElClasico({ now: new Date("2026-10-25T12:00:00Z"), data, calendar: [], standings });
const h = pre.html;
ok(pre.model.indexable && /content="index/.test(h), "index");
const title = h.match(/<title>([^<]+)/)[1]; const h1 = h.match(/<h1>([^<]+)/)[1]; const desc = h.match(/name="description" content="([^"]+)/)[1];
for (const [k, v] of Object.entries({ title, h1, desc })) ok(v.includes("El Clásico"), `${k} El Clásico içeriyor`);
ok(h.includes(`<link rel="canonical" href="https://www.futbolradar.com/${EL_CLASICO_SLUG}" />`), "uzantısız kanonik");
ok(h.includes('rel="manifest"') && h.includes("site.js"), "manifest + site.js");
ok(h.includes('id="yayin"') && h.includes("S Sport"), "yayın bölümü");
ok(h.includes("106") && h.includes("as.com"), "h2h + kaynak görünür");
const ld = JSON.parse(h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1].replaceAll("\\u003c", "<"));
const types = ld["@graph"].map((x) => x["@type"]);
for (const ty of ["SportsEvent", "BreadcrumbList", "FAQPage"]) ok(types.includes(ty), `JSON-LD ${ty}`);
ok(types.filter((x) => x === "SportsTeam").length === 2, "iki SportsTeam");
const faq = ld["@graph"].find((x) => x["@type"] === "FAQPage");
for (const q of faq.mainEntity) ok(h.includes(q.name.replaceAll("'", "&#039;")), `SSS görünür: ${q.name}`);
ok(!/width:\s*\d{4,}px/.test(h) && h.includes("overflow-x:auto"), "390px taşma koruması");
ok(h.includes("min-height:24px"), "24px dokunma hedefi");
ok(!/Muhtemel 11|Kadro/.test(h), "veri yokken kadro/muhtemel 11 yok");

// 3) Maçtan sonra skor yoksa 'sıradaki' gösterilmez, SportsEvent düşer.
const post = renderElClasico({ now: new Date("2026-10-26T12:00:00Z"), data, calendar: [], standings });
ok(!post.html.includes("Sıradaki El Clásico") && !post.html.includes('"SportsEvent"'), "geçmiş maç 'sıradaki' değil");
const done = renderElClasico({ now: new Date("2026-10-26T12:00:00Z"), data, standings, calendar: [{ providerId: "1570426", homeTeam: "Barcelona", awayTeam: "Real Madrid", kickoff: "2026-10-25T23:00:00+03:00", status: "FINISHED", score: { home: 1, away: 1 } }] });
ok(done.html.includes("Barcelona 1–1 Real Madrid"), "takvimden gelen skor son maç olur");

// 4) Veri yoksa noindex ve boş bölüm yok.
const empty = renderElClasico({ now: new Date("2026-10-26T12:00:00Z"), data: { fixtures: [] }, calendar: [], standings: {} });
ok(!empty.model.indexable && /noindex/.test(empty.html), "veri yok -> noindex");
ok(!empty.html.includes("clasico-tarihce") && !empty.html.includes("clasico-istatistik"), "boş bölüm çizilmez");

// 5) Kaynakları ve bağlama.
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
ok(pkg.scripts.postbuild.includes("generate-el-clasico-page.mjs"), "postbuild zincirinde");
const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
ok(vercel.includes(`"/${EL_CLASICO_SLUG}.html"`) && vercel.includes(`"destination": "/${EL_CLASICO_SLUG}.html"`), "vercel 308 + rewrite");
ok(fs.readFileSync(path.join(root, "scripts", "generate-league-standings-pages.mjs"), "utf8").includes(EL_CLASICO_SLUG), "La Liga hub bağlantısı");
// 6) Maç önü analiz (Köşe): her istatistik ve bölüm kaynaklı, H2/H3 yapısı, Article JSON-LD.
const pv = data.preview;
for (const s of pv.stats) ok(/^https:\/\//.test(pv.sources[s.source]?.sourceUrl || ""), `istatistik kaynaklı: ${s.label}`);
for (const x of pv.sections) ok(x.sources.length && x.sources.every((k) => /^https:\/\//.test(pv.sources[k]?.sourceUrl || "")), `bölüm kaynaklı: ${x.h3}`);
for (const html of [pre.html, post.html]) {
  ok(html.includes('<h2 id="mac-onu-analiz">Maç Önü Analiz</h2>'), "Maç Önü Analiz H2");
  ok((html.match(/<h1[\s>]/g) || []).length === 1, "tek H1");
  ok((html.match(/class="glass-card clasico-stat"/g) || []).length === pv.stats.length, "tüm istatistik blokları çizildi");
  ok(html.includes("Köşe") && html.includes('datetime="2026-10-25"'), "Köşe ve tarih künyesi");
}
const statBlocks = post.html.match(/<article class="glass-card clasico-stat">[\s\S]*?<\/article>/g) || [];
ok(statBlocks.every((b) => /Kaynak: <a href="https:\/\//.test(b)), "her istatistik bloğunda kaynak linki");
for (const id of pv.sections.map((x) => x.id)) ok(post.html.includes(`id="analiz-${id}"`), `H3 analiz-${id}`);
ok(!/10\.000 simülasyon|kaptan/i.test(post.html), "doğrulanamayan iddialar sayfada yok");
const colExists = fs.existsSync(path.join(root, "kose-yazilari", `${pv.column.slug}.html`));
ok(post.html.includes(`./kose-yazilari/${pv.column.slug}`) === colExists, "köşe yazısına yalnızca sayfası varsa bağlantı");
const pt = post.html.match(/<title>([^<]+)/)[1]; const pd = post.html.match(/name="description" content="([^"]+)/)[1];
ok(pt.includes("El Clásico") && pt.includes("Maç Önü Analiz") && pd.includes("El Clásico"), "maç sonrası başlık/açıklama El Clásico + analiz");
const pld = JSON.parse(post.html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
const art = pld["@graph"].find((x) => x["@type"] === "Article");
ok(art && art.datePublished === "2026-10-25" && art.citation.length >= 5, "Article JSON-LD + kaynaklar");
ok(!/href="\.\/(haberler|derbi-radari|lig\/la-liga)"/.test(post.html), "kırık uzantısız iç bağlantılar düzeltildi");
const noPv = renderElClasico({ now: new Date("2026-10-26T12:00:00Z"), data: { ...data, preview: { ...pv, sources: {} } }, calendar: [], standings });
ok(!noPv.html.includes('id="mac-onu-analiz"') && !noPv.html.includes('"Article"'), "kaynaksız analiz çizilmez");
console.log(`test-el-clasico-page: ${n} kontrol geçti`);
