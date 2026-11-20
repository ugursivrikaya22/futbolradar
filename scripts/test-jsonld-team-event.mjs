#!/usr/bin/env node
/**
 * ŞEMA BOŞLUKLARI (Person / SportsTeam / SportsEvent) — odak testi.
 *
 *  1. SportsEvent konum adresi yalnızca ev sahibinin doğrulanmış iç saha
 *     kaydıyla örtüşen statta yazılır; tarafsız/eşleşmeyen statta adres yok.
 *  2. Takım puan durumu sayfası SportsTeam düğümünü `about` ile bağlar.
 *  3. TR oyuncu profili modeli Türkçeleştirilir (mevki/uyruk İngilizce kalmaz).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sameVenue, venueAddressFor } from "./lib/eventVenueAddress.mjs";
import { turkishPlayer360 } from "./lib/player360English.mjs";
import { sportsTeamNode } from "./lib/teamRichResults.mjs";

const root = process.cwd();
let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const sources = {
  fixtureTeams: [
    { name: "Galatasaray", venue: "Rams Park", city: "İstanbul", status: "confirmed" },
    { name: "Beşiktaş", venue: "Tüpraş Stadyumu", city: "İstanbul", status: "confirmed" },
    { name: "Samsunspor", venue: "Yeni 19 Mayıs Stadyumu", city: "Samsun", status: "confirmed" },
    { name: "Trabzonspor", venue: "Papara Park", city: "Trabzon", status: "confirmed" },
    { name: "Taslak FK", venue: "Taslak Stadı", city: "Ankara", status: "draft" }
  ],
  calendar: []
};

check("stat eşleşmesi aksan ve 'Stadium/Stadyumu' farkını tolere eder", () => {
  assert.equal(sameVenue("Tüpraş Stadyumu", "Tupras Stadium"), true);
  assert.equal(sameVenue("Yeni 19 Mayıs Stadyumu", "Samsun 19 Mayis Stadyumu"), true);
  assert.equal(sameVenue("Rams Park", "Rams Park Stadyumu"), true);
});

check("farklı statlar eşleşmez ('Park' tek başına yetmez)", () => {
  assert.equal(sameVenue("Rams Park", "Papara Park"), false);
  assert.equal(sameVenue("Tüpraş Stadyumu", "Besiktas Park"), false);
  assert.equal(sameVenue("", "Rams Park"), false);
});

check("adres yalnızca doğrulanmış iç saha kaydından gelir", () => {
  assert.deepEqual(venueAddressFor(sources, "Galatasaray", "Rams Park"), {
    address: { "@type": "PostalAddress", addressLocality: "İstanbul", addressCountry: "TR" }
  });
  // Ev sahibi kendi statında değil (tarafsız saha) → şehir uydurulmaz.
  assert.deepEqual(venueAddressFor(sources, "Galatasaray", "Papara Park"), {});
  // Kayıt doğrulanmamış → adres yok.
  assert.deepEqual(venueAddressFor(sources, "Taslak FK", "Taslak Stadı"), {});
  // Süper Lig dışı takım → adres yok.
  assert.deepEqual(venueAddressFor(sources, "Liverpool", "Anfield"), {});
  assert.deepEqual(venueAddressFor(sources, "Galatasaray", ""), {});
});

check("maç sayfası üreticisi SportsEvent'e @id ve doğrulanmış adres bağlar", () => {
  const src = fs.readFileSync(path.join(root, "scripts", "generate-match-seo-pages.mjs"), "utf8");
  assert.match(src, /"@id": `\$\{urls\.canonical\}#event`/);
  assert.match(src, /venueAddressFor\(venueSources, entry\.homeTeam, entry\.venue\)/);
  // Skor schema.org SportsEvent'te tanımlı bir özellik değil; uydurma alan eklenmez.
  assert.doesNotMatch(src, /"?homeTeamScore"?\s*:/);
});

check("takım puan durumu sayfası SportsTeam düğümünü about ile bağlar", () => {
  const src = fs.readFileSync(path.join(root, "scripts", "generate-team-standings-pages.mjs"), "utf8");
  assert.match(src, /about: \{ "@id": `\$\{url\}#team` \}/);
  assert.match(src, /sportsTeamNode\(richSources, \{ name: team\.name, providerId: team\.providerId/);
});

check("TR oyuncu profili Türkçeleştirilmiş modelle üretilir", () => {
  const src = fs.readFileSync(path.join(root, "scripts", "generate-player-profile-pages.mjs"), "utf8");
  assert.match(src, /const model = turkishPlayer360\(buildPlayer360\(\{/);
  const model = turkishPlayer360({ identity: { position: "Attacker", nationality: "Nigeria", secondaryPosition: null } });
  assert.equal(model.identity.position, "Forvet");
  assert.equal(model.identity.nationality, "Nijerya");
});

check("ortak SportsTeam üreticisi yalnızca kayıtlı alanları yazar", () => {
  const node = sportsTeamNode(sources, { name: "Samsunspor", providerId: null, url: "https://www.futbolradar.com/takimlar/samsunspor", id: "x#team" });
  assert.equal(node["@type"], "SportsTeam");
  assert.equal(node.location.name, "Yeni 19 Mayıs Stadyumu");
  assert.equal(node.logo, undefined);
  JSON.parse(JSON.stringify(node));
});

console.log(`test-jsonld-team-event: ${passed} kontrol geçti`);
