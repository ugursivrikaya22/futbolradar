#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { POSTPROCESS_CHAIN } from "./lib/postprocessChain.mjs";

const root = process.cwd();
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const siteUrl = "https://www.futbolradar.com";

console.log("turkish-players-abroad");

const data = readJson("data/turkish-players-abroad.json");
const players = data.players;

{
  assert.ok(players.length >= 15 && players.length <= 25, `15–25 oyuncu bekleniyor, ${players.length} var`);
  const slugs = new Set();
  for (const player of players) {
    for (const field of ["name", "slug", "club", "position", "verifiedAt"]) {
      assert.ok(typeof player[field] === "string" && player[field].trim(), `${player.slug || player.name}: ${field} zorunlu`);
    }
    assert.match(player.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${player.slug}: slug biçimi`);
    assert.ok(!slugs.has(player.slug), `${player.slug}: kopya slug`);
    slugs.add(player.slug);
    assert.ok(["Kaleci", "Defans", "Orta saha", "Forvet"].includes(player.position), `${player.slug}: mevki`);
    assert.match(player.verifiedAt, /^\d{4}-\d{2}-\d{2}$/, `${player.slug}: verifiedAt`);
    for (const source of [player.source, player.secondarySource].filter(Boolean)) {
      assert.match(source.url, /^https:\/\//, `${player.slug}: kaynak https olmalı`);
      assert.ok(source.label, `${player.slug}: kaynak etiketi`);
    }
    assert.ok(player.source?.url, `${player.slug}: doğrulanmış kaynak zorunlu`);
    assert.ok(player.providerPlayerId === null || /^\d+$/.test(player.providerPlayerId), `${player.slug}: providerPlayerId`);
  }
  const registry = readJson("data/player-url-slugs.json");
  const taken = new Set((registry.entries || []).map((entry) => entry.slug).filter(Boolean));
  for (const slug of slugs) assert.ok(!taken.has(slug), `${slug}: Süper Lig oyuncu adresiyle çakışıyor`);
  console.log(`  ok  ${players.length} kaynaklı kayıt, slug çakışması yok`);
}

{
  const vercel = readJson("vercel.json");
  const rewrite = vercel.rewrites.find((rule) => rule.source === "/avrupadaki-turk-futbolcular");
  assert.equal(rewrite?.destination, "/avrupadaki-turk-futbolcular.html", "liste sayfası temiz adresi");
  const ids = POSTPROCESS_CHAIN.map((step) => step.id);
  const own = ids.indexOf("turkish-players-abroad-pages");
  assert.ok(own > ids.indexOf("national-team-pages") && own < ids.indexOf("shared-layout"), "zincir sırası");
  assert.match(fs.readFileSync(path.join(root, "scripts", "generate-national-team-pages.mjs"), "utf8"), /href: "avrupadaki-turk-futbolcular"/, "millî takım sayfası liste sayfasına bağlanmalı");
  console.log("  ok  temiz adres, zincir sırası ve millî takım bağlantısı");
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "abroad-"));
fs.mkdirSync(path.join(sandbox, "data"), { recursive: true });
fs.mkdirSync(path.join(sandbox, "public"), { recursive: true });
const fixturePlayers = [
  { name: "Kayıtlı Oyuncu", slug: "kayitli-oyuncu", club: "Örnek FC", position: "Forvet", providerPlayerId: "9001", source: { url: "https://example.org/a", label: "Kaynak A" }, verifiedAt: "2026-10-19" },
  { name: "Kayıtsız Oyuncu", slug: "kayitsiz-oyuncu", club: "Başka FC", position: "Defans", providerPlayerId: null, source: { url: "https://example.org/b", label: "Kaynak B" }, verifiedAt: "2026-10-19" },
  { name: "Çakışan Oyuncu", slug: "cakisan-oyuncu", club: "Üçüncü FC", position: "Kaleci", providerPlayerId: null, source: { url: "https://example.org/c", label: "Kaynak C" }, verifiedAt: "2026-10-19" }
];
const rows = [
  { providerPlayerId: "9001", matchId: "m1", team: "Örnek FC", date: "2026-09-01", competition: "La Liga", opponent: "X", home: true, started: true, minutes: 90, goals: 1, assists: 0 },
  { providerPlayerId: "9001", matchId: "m1", team: "Örnek FC", date: "2026-09-01", competition: "La Liga", opponent: "X", home: true, started: true, minutes: 90, goals: 1, assists: 0 },
  { providerPlayerId: "9001", matchId: "m2", team: "Türkiye", date: "2026-09-25", competition: "UEFA Uluslar Ligi", opponent: "Y", home: false, started: false, minutes: 20, assists: 1 },
  { providerPlayerId: "9001", matchId: "old", team: "Örnek FC", date: "2026-05-01", competition: "La Liga", opponent: "Z", home: true, started: true, minutes: 90, goals: 3, assists: 0 }
];
const foreign = `  <url>\n    <loc>${siteUrl}/milli-takim.html</loc>\n    <lastmod>2026-10-01</lastmod>\n  </url>`;
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${foreign}\n</urlset>\n`;
fs.writeFileSync(path.join(sandbox, "data", "turkish-players-abroad.json"), JSON.stringify({ players: fixturePlayers }));
fs.writeFileSync(path.join(sandbox, "data", "player-match-history.json"), JSON.stringify({ rows }));
fs.writeFileSync(path.join(sandbox, "data", "player-url-slugs.json"), JSON.stringify({ entries: [{ id: "x", slug: "cakisan-oyuncu" }] }));
fs.writeFileSync(path.join(sandbox, "sitemap.xml"), sitemap);
fs.writeFileSync(path.join(sandbox, "public", "sitemap.xml"), sitemap);
process.env.TURKISH_ABROAD_ROOT = sandbox;
const { run } = await import("./generate-turkish-players-abroad-pages.mjs");
run();
run();

const read = (relative) => fs.readFileSync(path.join(sandbox, relative), "utf8");
{
  const page = read("futbolcu/kayitli-oyuncu.html");
  assert.match(page, /<link rel="canonical" href="https:\/\/www\.futbolradar\.com\/futbolcu\/kayitli-oyuncu" \/>/);
  assert.match(page, /<html lang="tr">/);
  assert.match(page, /content="index,follow/);
  assert.match(page, /<span>Maç<\/span><b>2<\/b>/, "kopya satır ve sezon öncesi kayıt sayılmaz");
  assert.match(page, /<span>Dakika<\/span><b>110<\/b>/);
  assert.match(page, /<span>Asist<\/span><b>1<\/b>/);
  assert.doesNotMatch(page, /<span>Gol<\/span>/, "eksik gol alanı toplam gol olarak uydurulmaz");
  assert.match(page, /"@type":"Person"/);
  assert.equal(read("public/futbolcu/kayitli-oyuncu.html"), page, "public kopyası aynı");
  console.log("  ok  istatistik yalnızca depodaki kayıtlardan, eksik alan uydurulmuyor");
}
{
  const page = read("futbolcu/kayitsiz-oyuncu.html");
  assert.match(page, /content="noindex,follow"/, "kaydı olmayan oyuncu ince içerik: noindex");
  assert.doesNotMatch(page, /data-p360-section="season"|data-p360-section="matches"/, "kaydı yoksa istatistik bloğu yok");
  assert.ok(!fs.existsSync(path.join(sandbox, "futbolcu", "cakisan-oyuncu.html")), "çakışan slug yazılmaz");
  console.log("  ok  kaydı olmayan sayfa noindex, çakışan slug atlanıyor");
}
{
  const hub = read("avrupadaki-turk-futbolcular.html");
  assert.match(hub, /<link rel="canonical" href="https:\/\/www\.futbolradar\.com\/avrupadaki-turk-futbolcular" \/>/);
  assert.match(hub, /href="futbolcu\/kayitli-oyuncu"/);
  assert.match(hub, /href="futbolcu\/kayitsiz-oyuncu"/);
  assert.doesNotMatch(hub, /cakisan-oyuncu/);
  for (const file of ["sitemap.xml", "public/sitemap.xml"]) {
    const xml = read(file);
    const count = (loc) => xml.split(`<loc>${loc}</loc>`).length - 1;
    assert.equal(count(`${siteUrl}/avrupadaki-turk-futbolcular`), 1, `${file}: liste sayfası bir kez`);
    assert.equal(count(`${siteUrl}/futbolcu/kayitli-oyuncu`), 1, `${file}: dizinlenen oyuncu bir kez`);
    assert.equal(count(`${siteUrl}/futbolcu/kayitsiz-oyuncu`), 0, `${file}: noindex oyuncu haritada yok`);
    assert.equal(count(`${siteUrl}/milli-takim.html`), 1, `${file}: diğer kayıtlar korunuyor`);
  }
  console.log("  ok  liste sayfası ve site haritası (tekrar koşuda kopya yok)");
}

fs.rmSync(sandbox, { recursive: true, force: true });
console.log("turkish-players-abroad OK");
