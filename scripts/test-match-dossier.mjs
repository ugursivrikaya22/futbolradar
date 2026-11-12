/**
 * Türkiye - Belçika (12 Kasım 2026) kalıcı maç dosyası: kimlik, kaynak
 * beyaz listesi, hesaplanan sayılar, gizli köşe yuvası, editör alanı,
 * maç sonrası yer tutucusu ve bahis oranı yokluğu.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { readMatchEditorial, matchEditorialHtml } from "./lib/matchEditorial.mjs";
import { dossierStandings, dossierH2hTotals } from "./lib/matchDossier.mjs";

const root = process.cwd();
const slug = "turkiye-belcika-12-kasim-2026";
const entry = { slug, identity: "turkiye|belcika|2026-11-12", providerIds: {} };
const data = readMatchEditorial(root, entry);
assert.ok(data && data.kind === "dossier");
assert.throws(() => readMatchEditorial(root, { ...entry, identity: "turkiye|belcika|2026-10-02" }), /identity mismatch/);

// Sicil kaydı: tek kalıcı adres, doğru saat/stat/yayın.
const registry = JSON.parse(fs.readFileSync("data/match-seo-pages.json", "utf8")).pages;
const rows = registry.filter((p) => p.identity === entry.identity);
assert.equal(rows.length, 1, "one permanent URL for this match");
assert.equal(rows[0].slug, slug);
assert.equal(rows[0].kickoff, "2026-11-12T20:00:00+03:00");
assert.equal(rows[0].venue, "Gürsel Aksel Stadyumu");
assert.equal(rows[0].broadcast.turkey, "atv");
assert.ok(rows[0].indexable);
// Eski Belçika - Türkiye (2 Ekim) sayfası ayrı maçtır ve yerinde durur.
assert.ok(registry.some((p) => p.slug === "belgium-turkiye-2-ekim-2026"));

// Kaynaklar: beyaz liste + yasaklı kaynak yok.
for (const s of Object.values(data.sources)) assert.doesNotMatch(s.url, /wikipedia|thesportsdb|transfermarkt|fbref/i);
const hosts = new Set(Object.values(data.sources).map((s) => new URL(s.url).hostname.replace(/^www\./, "")));
for (const host of ["tff.org", "rbfa.be", "uefa.com", "fotomac.com.tr"]) assert.ok([...hosts].some((h) => h === host || h.endsWith(`.${host}`)), host);

// Hesaplanan sayılar.
const table = dossierStandings(data.group.results);
assert.deepEqual(table.map((r) => [r.team, r.points]), [["Fransa", 10], ["İtalya", 7], ["Belçika", 6], ["Türkiye", 0]]);
assert.deepEqual(dossierH2hTotals(data.h2h.rows, "Türkiye"), { played: 12, won: 3, drawn: 5, lost: 4, gf: 17, ga: 21 });
const squadCount = (side) => data.squads[side].groups.reduce((n, g) => n + g.players.length, 0);
assert.equal(squadCount("home"), 26);
assert.equal(squadCount("away"), 26);

const html = matchEditorialHtml(data, { columns: [] });
for (const term of ["20:00 TSİ", "ATV", "Gürsel Aksel", "23.376", "Sergen Yalçın", "Mark van Bommel", "Hakan Çalhanoğlu", "108 maç / 22 gol", "Leandro Trossard", "12 kez karşılaştı", "17-21", "Diziliş: resmî maç kaydında belirtilmedi"]) assert.ok(html.includes(term), term);
for (const link of html.matchAll(/<a href="https?:[^>]+>/g)) assert.match(link[0], /rel="nofollow noopener noreferrer"/);

// Köşe yuvası boşken bölüm yok; editör alanı ve bahis oranı asla basılmaz.
assert.ok(!html.includes('id="kose"'), "empty column slot stays hidden");
for (const idea of data.editorOnly.columnTopicIdeas) assert.ok(!html.includes(idea), "editor-only ideas are not rendered");
assert.doesNotMatch(html, /iddaa|bahis|oran(lar)?ı/i, "no odds without a licensed official source");

// 11 Kasım basın toplantısı: alıntı + sakatlık notları, görünür Fotomaç kaynağı.
assert.match(html, /id="son-durum"/);
assert.ok(html.includes("Santrfor yok mu diyordunuz gelirken getirdim, var. Enes başlayacak, santrfor yanımızda"));
assert.ok(html.includes("Belçika maçı öncesi"));
assert.ok(html.includes("Kenan") && html.includes("Aral") && html.includes("Zeki"));
// Maç sonrası: resmî ilk 11'ler ve değişiklikler kaynaklı satır olarak basılır.
assert.ok(html.includes("İlk 11'ler (resmî)") && html.includes("Enes Ünal") && html.includes("Charles De Ketelaere"));
assert.ok(html.includes("Oyuncu değişiklikleri") && html.includes("De Bruyne yerine Leandro Trossard"));
assert.match(html, /id="muhtemel-11"/);
assert.ok(html.includes("Muhtemel 11'ler:") && html.includes("Güncelleniyor"));
assert.match(html, /href="https:\/\/beinsports\.com\.tr\/haber\/a-milli-takim-sergen-yalcin-yonetiminde-ilk-sinavina-cikiyor"[^>]*rel="nofollow noopener noreferrer"/);
assert.match(html, /href="https:\/\/www\.uefa\.com\/uefanationsleague\/match\/2047873--turkiye-vs-belgium\/matchinfo\/"[^>]*rel="nofollow noopener noreferrer"/);
assert.ok(html.includes("Sandro Schärer") && html.includes("Stéphane De Almeida") && html.includes("Luca Cibelli"));

assert.match(html, /href="https:\/\/www\.fotomac\.com\.tr\/uluslar-ligi\/2026\/11\/11\/a-milli-takim-teknik-direktoru-sergen-yalcindan-irfan-can-kahveci-sozleri"[^>]*rel="nofollow noopener noreferrer"/);


// Köşe metni geldiğinde FutbolRadar imzasıyla basılır; bağlı yazı listesi de bloğu açar.
const withColumn = matchEditorialHtml({ ...data, column: { title: "Deneme", body: ["Paragraf."], author: "FutbolRadar", publishedAt: "2026-11-11" } });
assert.match(withColumn, /id="kose"[\s\S]*Yazar: FutbolRadar[\s\S]*Deneme/);
assert.match(matchEditorialHtml(data, { columns: [{ title: "Bağlı yazı", href: "../kose-yazilari/x" }] }), /id="kose"[\s\S]*Bağlı yazı/);

// Maç sonrası özeti kaynaklıysa basılır; kaynaksız ya da boşken yer tutucu kalır.
assert.match(html, /id="mac-sonrasi"[\s\S]*Arda Güler 20\. dakikada serbest vuruştan[\s\S]*rel="nofollow noopener noreferrer"/);
assert.ok(!html.includes("Maç sonrası:</strong> Güncelleniyor"));
assert.ok(matchEditorialHtml({ ...data, postMatch: { summary: "Özet", sources: [] } }).includes("Güncelleniyor"));
assert.ok(matchEditorialHtml({ ...data, postMatch: { summary: null, sources: [] } }).includes("Maç sonrası:</strong> Güncelleniyor"));

// Üretilen sayfa (varsa): kanonik, şema, tek H1, dosya bölümleri.
const pagePath = `mac/${slug}.html`;
if (fs.existsSync(pagePath)) {
  const page = fs.readFileSync(pagePath, "utf8");
  assert.match(page, new RegExp(`<link rel="canonical" href="https://www.futbolradar.com/mac/${slug}"`));
  assert.match(page, /"@type":"SportsEvent"/);
  assert.match(page, /"@type":"BreadcrumbList"/);
  assert.equal((page.match(/<h1[\s>]/g) || []).length, 1);
  assert.ok(page.includes('id="mac-dosyasi"') && page.includes('id="mac-sonrasi"'));
}
console.log("match-dossier: identity, sources, computed standings/h2h, squads, hidden column slot, editor-only, no odds, post-match placeholder passed");
