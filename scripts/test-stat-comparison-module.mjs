/**
 * Kaynaklı karşılaştırma modülü: uydurma sayı yok, çift adresi alfabetik,
 * kulüp geçmişi ve en az 30 oyuncu.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dir = path.join(root, "data", "comparison-module", "players");
const files = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
const players = files.map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));

assert.ok(players.length >= 30, `en az 30 oyuncu gerekli, ${players.length}`);

const slugs = new Set();
for (const player of players) {
  assert.equal(player.slug, files.find((name) => name === `${player.slug}.json`)?.replace(/\.json$/, ""));
  assert.ok(!slugs.has(player.slug), `çift slug ${player.slug}`);
  slugs.add(player.slug);
  assert.match(player.retrievedAt, /^2026-11-1[45]$/);
  for (const group of ["identity", "career", "seasons", "technical", "last5", "matches", "careerClubs"]) {
    assert.ok(player[group]?.sourceUrl, `${player.slug} ${group} kaynak yok`);
    assert.match(player[group].retrievedAt, /^2026-11-1[45]$/);
  }
  for (const field of ["dribbles", "dispossessed", "xg", "xa"]) {
    const value = player.technical[field];
    assert.ok(value == null || Number.isFinite(value), `${player.slug} ${field}`);
    if (value != null) {
      assert.match(player.technical[`${field}Scope`] || "", /2026/);
      assert.match(player.technical.officialSourceUrl || "", /^https:\/\//);
    }
  }
  if (player.identity.weightKg != null) {
    assert.match(player.identity.weightSourceUrl || "", /^https:\/\//);
  }
  assert.ok(player.identity.birthDate == null || /^\d{4}-\d{2}-\d{2}$/.test(player.identity.birthDate));
  assert.ok(player.identity.nationality == null || !/itemprop|<|>/.test(player.identity.nationality), player.identity.nationality);
  assert.ok(Array.isArray(player.careerClubs.stints) && player.careerClubs.stints.length > 0, `${player.slug} kulüp geçmişi yok`);
  assert.equal(JSON.stringify(player).includes("Veri yok"), false);
}

const hub = path.join(root, "oyuncu-karsilastirma.html");
assert.ok(fs.existsSync(hub), "hub üretilmemiş");
const hubHtml = fs.readFileSync(hub, "utf8");
assert.match(hubHtml, /<h1>Oyuncu karşılaştırma<\/h1>/);
assert.match(hubHtml, /data-fr-module="stat-comparison"/);
for (const player of players.slice(0, 5)) {
  assert.ok(fs.existsSync(path.join(root, "oyuncu-karsilastirma", `${player.slug}.html`)));
  assert.ok(hubHtml.includes(player.name));
}

const pairDir = path.join(root, "karsilastirma");
const modulePairs = fs.readdirSync(pairDir).filter((name) => {
  if (!name.endsWith(".html")) return false;
  return fs.readFileSync(path.join(pairDir, name), "utf8").includes('data-fr-module="stat-comparison"');
});
assert.ok(modulePairs.length >= 20, `kıyas sayfası az: ${modulePairs.length}`);
for (const file of modulePairs) {
  const slug = file.replace(/\.html$/, "");
  const [left, right] = slug.split("-vs-");
  assert.ok(left && right && left < right, `kanonik sıra değil: ${slug}`);
  const html = fs.readFileSync(path.join(pairDir, file), "utf8");
  assert.match(html, /Kulüp geçmişi|kulüpler/);
  assert.equal((html.match(/<h1[\s>]/gi) || []).length, 1);
}

const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
assert.ok(vercel.rewrites.some((rule) => rule.source === "/oyuncu-karsilastirma"));
assert.equal(vercel.git.deploymentEnabled["cursor/**"], true);
assert.ok(vercel.redirects.length <= 1024, `yönlendirme sınırı: ${vercel.redirects.length}`);
const sample = modulePairs[0].replace(/\.html$/, "");
const [a, b] = sample.split("-vs-");
const middleware = fs.readFileSync(path.join(root, "middleware.js"), "utf8");
assert.match(middleware, new RegExp(`"${b}-vs-${a}": "${sample}"`));

console.log(`stat-comparison OK: ${players.length} oyuncu, ${modulePairs.length} kıyas`);
