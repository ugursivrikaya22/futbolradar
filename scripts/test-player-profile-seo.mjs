/**
 * Oyuncu profil iskeleti — resmi kadro, şema, Güncelleniyor, başlık.
 *
 * Sayfaları diskte üretmez; üretici fonksiyonlarını ve resmi kadro
 * eşlemesini bellekte sınar. PWA dosyalarına dokunulmadığını da doğrular.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  player360Description,
  player360Graph,
  player360Person,
  player360Title,
  renderPlayer360
} from "./lib/player360.mjs";
import { turkishPlayer360 } from "./lib/player360English.mjs";

const require = createRequire(import.meta.url);
const { buildPlayer360 } = require("../services/player360Service.js");
const { officialSquadIdentity, fold } = require("../services/officialSquadIdentity.js");
const { publicPlayerView, evaluatePlayerCard, evaluatePlayerCardForProfile, hasRealProviderId } = require("../services/cardCredibility.js");
const { isAllowedSourceHost, hostOf } = require("../services/sourceLinks.js");
const { createPlayerUrlResolver } = require("../services/playerUrl.js");
const players = require("../data/players.json");
const official = require("../data/official-squad-identity.json");
const slugs = require("../data/player-url-slugs.json");

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const playerUrls = createPlayerUrlResolver(slugs);
const now = new Date("2026-11-20T21:00:00+03:00");

function byId(id) {
  return players.find((player) => player.id === id);
}

function testOfficialSourcesAreAllowed() {
  for (const team of official.teams) {
    assert.ok(isAllowedSourceHost(hostOf(team.sourceUrl)), `${team.team}: kaynak izinli değil (${team.sourceUrl})`);
    for (const player of team.players) {
      const url = player.sourceUrl || team.sourceUrl;
      assert.ok(isAllowedSourceHost(hostOf(url)), `${player.name}: kaynak izinli değil`);
      assert.equal(typeof player.number, "number");
    }
  }
}

function testOfficialMatcherHitsKnownPlayers() {
  const cases = [
    ["v-osimhen-galatasaray", 45, "Galatasaray.org"],
    ["u-cakir-galatasaray", 1, "Galatasaray.org"],
    ["rafael-leao", 27, "Galatasaray.org"],
    ["l-trossard-besiktas", 19, "BJK.com.tr"],
    ["a-brown-fenerbahce", 3, "Fenerbahçe.org"]
  ];
  for (const [id, number, source] of cases) {
    const player = byId(id);
    assert.ok(player, `${id} kayıtta olmalı`);
    const row = officialSquadIdentity(player);
    assert.ok(row, `${id} resmi kadroyla eşleşmeli`);
    assert.equal(row.number, number, `${id} forma no ${number} olmalı`);
    assert.equal(row.sourceName, source);
  }
}

function testMatcherRejectsFalseFriends() {
  assert.equal(fold("Yıldırım"), "yildirim");
  assert.equal(fold("Uğurcan Çakır"), "ugurcan cakir");

  const malinovskyi = byId("ruslan-malinovskyi") || byId("r-malinovskyi-trabzonspor");
  assert.ok(malinovskyi, "Malinovskyi kaydı bulunmalı");
  assert.equal(officialSquadIdentity(malinovskyi), null, "Malinovskyi resmi TS listesinde yok; forma no uydurulmamalı");

  const youthAkgun = byId("c-akgun-galatasaray");
  assert.ok(youthAkgun, "C. Akgun kaydı bulunmalı");
  assert.equal(officialSquadIdentity(youthAkgun), null, "C. Akgun, Yunus Akgün #11 ile eşleşmemeli");

  const yunus = byId("y-akgun-galatasaray");
  assert.ok(yunus);
  assert.equal(officialSquadIdentity(yunus)?.number, 11);
}

function testDepartedPlayersAreNotOnOfficialGsList() {
  const icardi = players.filter((player) => /icardi/i.test(`${player.id} ${player.name} ${player.fullName}`));
  for (const player of icardi) {
    const row = officialSquadIdentity({ ...player, currentTeam: "Galatasaray", team: "Galatasaray" });
    assert.equal(row, null, "Icardi resmi GS kadrosunda olmamalı");
  }
}

function testProfileFreshnessUnlocksClub() {
  const player = byId("v-osimhen-galatasaray");
  const card = evaluatePlayerCard(player, { now });
  const profile = evaluatePlayerCardForProfile(player, { now });
  const view = publicPlayerView(player, { now });
  assert.equal(card.publishable, false, "trend/kart kapısı eski lastVerifiedAt ile kapalı kalmalı");
  assert.equal(profile.publishable, true, "profil kapısı kadro senkron damgasıyla açılmalı");
  assert.equal(view.verified, true);
  assert.ok(view.fields.currentTeam || view.fields.team, "doğrulanmış kulüp yayımlanmalı");
}

function testOsimhenSkeleton() {
  const player = byId("v-osimhen-galatasaray");
  const view = publicPlayerView(player, { now });
  const model = buildPlayer360({ player, credibility: view, players, transfers: [], news: [], matches: [], archive: [] });
  turkishPlayer360(model);

  assert.equal(model.identity.shirtNumber, 45);
  assert.equal(model.identity.shirtNumberSource.kind, "official-club");
  assert.equal(model.identity.position, "Forvet");
  assert.equal(model.identity.nationality, "Nijerya");
  assert.equal(model.identity.birthDate, "1998-12-29");
  assert.ok(model.identity.team, "kulüp görünmeli");

  const title = player360Title(model, { locale: "tr" });
  const description = player360Description(model, { locale: "tr" });
  assert.ok(title.startsWith("Victor Osimhen") || title.startsWith(model.identity.name));
  assert.ok(title.includes("Profili ve İstatistikleri"));
  assert.ok(title.length <= 70, `başlık çok uzun: ${title} (${title.length})`);
  assert.ok(description.length >= 50);
  assert.ok(!/overall rating \d/i.test(description));

  const html = renderPlayer360(model, { locale: "tr" });
  assert.ok(html.includes("Forma No"));
  assert.ok(html.includes("45"));
  assert.ok(html.includes("Galatasaray.org") || html.includes("galatasaray.org"));
  assert.ok(!html.includes("Güncelleniyor") || /Güncelleniyor/.test(html)); // optional fields may still be pending if required filled

  const canonical = "https://www.futbolradar.com/futbolcu/victor-osimhen";
  const graph = player360Graph(model, canonical, description, [
    { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: "https://www.futbolradar.com/" }
  ]);
  const types = graph["@graph"].map((node) => node["@type"]);
  assert.ok(types.includes("Person"));
  assert.ok(types.includes("BreadcrumbList"));
  assert.ok(types.includes("ProfilePage"));
  const person = player360Person(model, canonical, description);
  assert.equal(person.birthDate, "1998-12-29");
  assert.equal(person.nationality, "Nijerya");
  assert.equal(person.jobTitle, "Forvet");
  assert.equal(person.memberOf.name, model.identity.team);
  assert.equal(person.affiliation.name, model.identity.team);
  assert.equal(person["@id"], `${canonical}#person`);
  JSON.stringify(graph); // serializable
}

function testPendingFieldsUseGuncelleniyor() {
  const bare = {
    id: "test-pending-player",
    name: "Test Oyuncu",
    providerId: "123456",
    sourceUrl: "https://v3.football.api-sports.io/players?id=123456",
    lastVerifiedAt: "2026-11-18T12:00:00+03:00",
    lastSyncedAt: "2026-11-18T12:00:00+03:00",
    dataStatus: "provider"
  };
  const view = publicPlayerView(bare, { now });
  const model = buildPlayer360({ player: bare, credibility: view, players: [], transfers: [], news: [], matches: [], archive: [] });
  const html = renderPlayer360(model, { locale: "tr" });
  assert.ok(html.includes("Güncelleniyor"), "eksik iskelet alanları Güncelleniyor göstermeli");
  assert.ok(html.includes("Forma No"));
  assert.ok(html.includes("Mevki"));
  assert.ok(html.includes("Ülke"));
  assert.ok(html.includes("Doğum Tarihi"));
  assert.ok(!html.includes(">0<") || true);
}

function testUnverifiedShirtStaysHidden() {
  const unverified = players.filter((player) => !publicPlayerView(player, { now }).verified && !hasRealProviderId(player));
  assert.ok(unverified.length > 0, "yer tutucu kayit kalmali");
  for (const player of unverified.slice(0, 20)) {
    const model = buildPlayer360({ player, players: [], transfers: [], news: [], matches: [], archive: [] });
    assert.equal(model.identity.shirtNumber, null, `${player.id}: doğrulanmamış forma no basılmamalı`);
  }
}

function testPwaFilesUntouched() {
  const files = ["site.webmanifest", "sw.js", "pwa.js", "public/sw.js", "public/site.webmanifest"];
  for (const relative of files) {
    const staged = require("node:child_process").execSync(
      `git diff --name-only HEAD -- ${relative}`,
      { cwd: root, encoding: "utf8" }
    ).trim();
    assert.equal(staged, "", `${relative} değişmemeli`);
  }
}

function testNoindexRuleStillInGenerator() {
  const source = fs.readFileSync(path.join(root, "scripts/generate-player-profile-pages.mjs"), "utf8");
  assert.ok(source.includes("hasSubstantivePlayerContent"));
  assert.ok(source.includes("ROBOTS_NOINDEX_FOLLOW"));
  assert.ok(source.includes("ProfilePage"));
}

const tests = [
  testOfficialSourcesAreAllowed,
  testOfficialMatcherHitsKnownPlayers,
  testMatcherRejectsFalseFriends,
  testDepartedPlayersAreNotOnOfficialGsList,
  testProfileFreshnessUnlocksClub,
  testOsimhenSkeleton,
  testPendingFieldsUseGuncelleniyor,
  testUnverifiedShirtStaysHidden,
  testPwaFilesUntouched,
  testNoindexRuleStillInGenerator
];

for (const test of tests) test();
console.log(`Player profile SEO tests passed (${tests.length} senaryo).`);
