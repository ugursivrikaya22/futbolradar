/**
 * OYUNCU ADI VARYASYONLARI İLE SAĞLAYICI EŞLEŞTİRMESİ.
 *
 * Bildirilen: "Eren Elmalı", "Mason Greenwood" profili "istatistikleri henüz
 * doğrulanmış bir kaynakla eşleşmedi" diyor. Kök neden: sağlayıcı "E. Elmalı"
 * yazıyor, eşleşme birebir ad istiyordu.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { classifyPlaceholders } from "./reconcile-player-provider-matches.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const { compareNames, foldName, sameTeam, pickUniqueVariant } = require("../services/playerNameMatching.js");
const { matchCanonicalPlayer } = require("../services/squadSyncService.js");
const { reconcileSquadPlayer } = require("../services/playerCanonicalService.js");

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`ok - ${name}`); };
const method = (a, b) => (compareNames(a, b) || {}).method || null;

test("ad varyasyonları: baş harf, aksan, tek ad, ters sıra, çok sözcüklü soyisim", () => {
  assert.equal(method("Eren Elmalı", "E. Elmalı"), "initial-surname");
  assert.equal(method("Mason Greenwood", "M. Greenwood"), "initial-surname");
  assert.equal(method("Uğurcan Çakır", "Ugurcan Cakir"), "exact");
  assert.equal(method("İrfan Can Eğribayat", "i̇rfan can egribayat"), "exact");
  assert.equal(method("Barış Alper Yılmaz", "B. A. Yılmaz"), "initial-surname");
  assert.equal(method("Tim Jabol-Folcarelli", "T. Jabol-Folcarelli"), "initial-surname");
  assert.equal(method("Kojo Peprah Oppong", "K. Peprah Oppong"), "initial-surname");
  assert.equal(method("Hyeon-gyu Oh", "Oh Hyeon-gyu"), "token-set");
  assert.equal(method("Dorgeles Nene", "N. Dorgeles"), "initial-token-set");
  assert.equal(method("Ederson Santana de Moraes", "Ederson"), "token-subset");
  assert.equal(method("Talisca", "Anderson Talisca"), "token-subset");
  assert.equal(foldName("Şükrü Ğ. Öz-Çelik"), "sukru g oz celik");
});

test("farklı kişiler eşleşmez: baş harf uyuşmazlığı, kısa tek ad, orta ad tuzağı, yakın yazım", () => {
  assert.equal(method("Barış Alper Yılmaz", "J. Yılmaz"), null);
  assert.equal(method("Barış Alper Yılmaz", "A. Yılmaz"), null, "orta ad (Alper) baş harfi ilk ada bağlanmaz");
  assert.equal(method("Michael Murillo", "A. Murillo"), null);
  assert.equal(method("Ali Yılmaz", "Ali"), null, "kısa tek ad her 'Ali X' ile eşleşmez");
  assert.equal(method("Eren Elmalı", "Eren Ekmeli"), null);
  assert.equal(method("", "E. Elmalı"), null);
});

test("takım: sponsor önü ve ek atılır, farklı kulüpler ayrı kalır", () => {
  assert.ok(sameTeam("Çaykur Rizespor", "Rizespor"));
  assert.ok(sameTeam("Corendon Alanyaspor", "Alanyaspor"));
  assert.ok(sameTeam("Gençlerbirliği S.K.", "Gençlerbirliği"));
  assert.ok(sameTeam("İstanbul Başakşehir", "Başakşehir FK"));
  assert.ok(!sameTeam("İstanbulspor", "Başakşehir"));
  assert.ok(!sameTeam("Galatasaray", "Fenerbahçe"));
  assert.ok(!sameTeam("", ""));
});

test("tek ve açık aday gerekir: birden çok aday ya da farklı takım eşleşme sayılmaz", () => {
  const target = { id: "a", name: "Ahmet Yılmaz", currentTeam: "X" };
  const twin = { id: "b", name: "A. Yılmaz", currentTeam: "X FK", providerId: "1" };
  assert.equal(pickUniqueVariant(target, [twin]).match.player.id, "b");
  const second = { id: "c", name: "A. Yilmaz", currentTeam: "X", providerId: "2" };
  assert.equal(compareNames("Ahmet Yılmaz", "Ali Yılmaz"), null, "Ali, Ahmet'in varyasyonu değil");
  assert.equal(pickUniqueVariant(target, [twin, second]).reason, "ambiguous");
  assert.equal(pickUniqueVariant(target, [{ ...twin, currentTeam: "Y" }]).reason, "no-variant");
});

const elmaliCurated = { id: "eren-elmali", name: "Eren Elmalı", currentTeam: "Galatasaray", providerId: "mock-eren-elmali", dataStatus: "verified" };
const provider = { providerId: "50057", name: "E. Elmalı", position: "Defender" };

test("kadro senkronu: kısa adlı sağlayıcı satırı elle kayda bağlanır (yeni ikiz açılmaz)", () => {
  const resolution = matchCanonicalPlayer([elmaliCurated], { ...provider, team: "Galatasaray" }, null);
  assert.equal(resolution.method, "name-variant+team+placeholder-provider-id");
  assert.equal(resolution.match.id, "eren-elmali");

  const outcome = reconcileSquadPlayer([elmaliCurated], provider, { name: "Galatasaray" });
  assert.equal(outcome.action, "update");
  assert.equal(outcome.player.id, "eren-elmali");
  assert.equal(outcome.player.providerId, "50057", "gerçek sağlayıcı kimliği bağlanmalı");
  assert.equal(outcome.player.currentTeam, "Galatasaray");
  assert.equal(outcome.player.dataStatus, "verified", "elle doğrulanmış durum korunur");
});

test("kadro senkronu: kimlik başka kayıtta varsa, aday birden çoksa, takım farklıysa bağlanmaz", () => {
  const twin = { id: "e-elmali-galatasaray", name: "E. Elmalı", currentTeam: "Galatasaray", providerId: "50057" };
  assert.equal(matchCanonicalPlayer([elmaliCurated, twin], { ...provider, team: "Galatasaray" }, null).method, "providerId", "kimlik zaten bağlıysa kimlik kazanır");

  const other = { id: "emre-elmali", name: "Emre Elmalı", currentTeam: "Galatasaray", providerId: "mock-emre-elmali" };
  const ambiguous = matchCanonicalPlayer([elmaliCurated, other], { ...provider, team: "Galatasaray" }, null);
  assert.equal(ambiguous.match, null, "iki aday varken eşleşme uydurulmaz");

  assert.equal(matchCanonicalPlayer([elmaliCurated], { ...provider, team: "Fenerbahçe" }, null).match, null, "takım farklı");
  const gone = reconcileSquadPlayer([elmaliCurated], { ...provider, providerId: "50057" }, { name: "Fenerbahçe" });
  assert.equal(gone.action, "create");
});

test("gerçek veri: Eren Elmalı ve Mason Greenwood sağlayıcı ikiziyle eşleşir, belirsiz yok", () => {
  const players = JSON.parse(fs.readFileSync(path.join(repo, "data", "players.json"), "utf8"));
  const result = classifyPlaceholders(players);
  const byId = Object.fromEntries(result.matched.map((row) => [row.id, row]));
  assert.equal(byId["eren-elmali"].twinId, "e-elmali-galatasaray");
  assert.equal(byId["eren-elmali"].providerId, "50057");
  assert.equal(byId["mason-greenwood"].twinId, "m-greenwood-fenerbahce");
  assert.equal(result.ambiguous.length, 0);
  assert.equal(result.summary.matched + result.summary.ambiguous + result.summary.unmatched, result.summary.placeholderRecords, "her yer tutucu kayıt tam bir grupta");
  assert.ok(result.summary.matched >= 100, `varyasyonlu eşleşme çalışmıyor: ${result.summary.matched}`);
  // Aynı sağlayıcı kimliği iki elle kayda atanmamış olmalı.
  const ids = result.matched.map((row) => row.providerId);
  assert.equal(new Set(ids).size, ids.length);
});

test("eşleşmeyen rapor: neden ve ipucu taşır; kadro dışı oyuncu nedenle listelenir", () => {
  const players = JSON.parse(fs.readFileSync(path.join(repo, "data", "players.json"), "utf8"));
  const { unmatched } = classifyPlaceholders(players);
  const icardi = unmatched.find((row) => row.id === "mauro-icardi");
  assert.ok(icardi, "Icardi (serbest oyuncu) eşleşmeyenlerde olmalı");
  assert.equal(icardi.reason, "team-not-in-provider-squads");
  const murillo = unmatched.find((row) => row.name === "Michael Murillo");
  assert.equal(murillo.reason, "no-name-match-in-team");
  assert.ok(murillo.hints.some((hint) => hint.name === "A. Murillo"), "benzer kayıt ipucu olarak yazılmalı");
  for (const row of unmatched) assert.ok(row.reason && row.id && row.name, `eksik alan: ${JSON.stringify(row)}`);
});

test("betik: rapor yazar, players.json'a DOKUNMAZ, --apply yok", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "player-match-"));
  try {
    fs.mkdirSync(path.join(dir, "data"));
    const players = JSON.stringify([
      elmaliCurated,
      { id: "e-elmali-galatasaray", name: "E. Elmalı", currentTeam: "Galatasaray", providerId: "50057" },
      { id: "yok", name: "Kimse Yok", currentTeam: "Serbest oyuncu", providerId: "mock-yok" }
    ], null, 2) + "\n";
    fs.writeFileSync(path.join(dir, "data", "players.json"), players);
    const run = spawnSync(process.execPath, [path.join(here, "reconcile-player-provider-matches.mjs"), "--apply"], { cwd: dir, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(fs.readFileSync(path.join(dir, "data", "players.json"), "utf8"), players, "veri dosyası değişmemeli");
    const report = JSON.parse(fs.readFileSync(path.join(dir, "data", "player-provider-match-report.json"), "utf8"));
    assert.equal(report.summary.matched, 1);
    assert.equal(report.summary.unmatched, 1);
    assert.ok(!("applied" in report));
    const md = fs.readFileSync(path.join(dir, "docs", "player-provider-match-report.md"), "utf8");
    assert.ok(md.includes("Kimse Yok") && md.includes("Eren Elmalı"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`player name matching: ${passed} test geçti`);
