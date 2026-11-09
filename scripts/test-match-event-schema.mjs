/**
 * MAÇ SportsEvent İŞARETLEMESİ.
 *
 * Bitmiş maç EventScheduled yazmaz (schema.org'da EventCompleted yoktur).
 * Canlı ve planlı maç EventScheduled, erteleme EventPostponed, iptal
 * EventCancelled olur. Stat yokken stadyum adı uydurulmaz; yurt içi
 * lig/kupa ülkesi adres olarak kalır. TR ve EN aynı olguyu taşır.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { validateBlocks } from "./lib/structuredData.mjs";

const require = createRequire(import.meta.url);
const {
  eventStatusForPageState,
  eventStatusOf,
  locationOf,
  sportsEventNode,
  startDateOf
} = require("../services/matchSchema.js");
const root = process.cwd();

function match(overrides = {}) {
  return {
    homeTeam: "Ev",
    awayTeam: "Deplasman",
    kickoff: "2026-10-07T14:00:00+03:00",
    status: "SCHEDULED",
    competitionId: "hazirlik-maci",
    league: "Hazırlık Maçı",
    ...overrides
  };
}

{
  assert.equal(eventStatusOf(match({ status: "FINISHED" })), null);
  assert.equal(eventStatusOf(match({ status: "FT" })), null);
  assert.equal(eventStatusOf(match({ status: "AWARDED" })), null);
  assert.equal(eventStatusOf(match({ status: "INT" })), null);
  assert.equal(eventStatusOf(match({ status: "LIVE" })), "https://schema.org/EventScheduled");
  assert.equal(eventStatusOf(match({ status: "1H" })), "https://schema.org/EventScheduled");
  assert.equal(eventStatusOf(match({ status: "HT" })), "https://schema.org/EventScheduled");
  assert.equal(eventStatusOf(match({ status: "NS" })), "https://schema.org/EventScheduled");
  assert.equal(eventStatusOf(match({ status: "PST" })), "https://schema.org/EventPostponed");
  assert.equal(eventStatusOf(match({ status: "CANC" })), "https://schema.org/EventCancelled");
  assert.equal(eventStatusOf(match({ status: "ABD" })), "https://schema.org/EventCancelled");
  assert.equal(eventStatusOf(match({ status: "" })), null, "bilinmeyen durum EventScheduled sayılmaz");

  assert.equal(eventStatusForPageState("post"), null);
  assert.equal(eventStatusForPageState("pending"), null);
  assert.equal(eventStatusForPageState("interrupted"), null);
  assert.equal(eventStatusForPageState("live"), "https://schema.org/EventScheduled");
  assert.equal(eventStatusForPageState("pre"), "https://schema.org/EventScheduled");
  assert.equal(eventStatusForPageState("postponed"), "https://schema.org/EventPostponed");
  assert.equal(eventStatusForPageState("cancelled"), "https://schema.org/EventCancelled");
}

{
  const finished = sportsEventNode(match({
    status: "FINISHED",
    homeTeam: "Galatasaray",
    awayTeam: "Çorum FK",
    venue: "Rams Park",
    competitionId: "super-lig",
    league: "Süper Lig"
  }));
  assert.equal(finished.eventStatus, undefined);
  assert.equal(finished.startDate, "2026-10-07T14:00:00+03:00");
  assert.equal(finished.homeTeam.name, "Galatasaray");
  assert.equal(finished.awayTeam.name, "Çorum FK");
  assert.equal(finished.location["@type"], "Place");
  assert.equal(finished.location.name, "Rams Park");
  assert.equal(finished.location.address.addressLocality, "İstanbul");
  assert.equal(finished.location.address.addressCountry, "TR");
  assert.equal(JSON.stringify(finished).includes("homeScore"), false);

  const scheduled = sportsEventNode(match({ status: "NS", competitionId: "super-lig", league: "Süper Lig" }));
  assert.equal(scheduled.eventStatus, "https://schema.org/EventScheduled");
  assert.equal(scheduled.location.name, undefined, "stat adı uydurulmaz");
  assert.equal(scheduled.location.address.addressCountry, "TR");
  assert.equal(scheduled.location.address.addressLocality, undefined);

  const cup = locationOf({ competitionId: "turkiye-kupasi", league: "Türkiye Kupası", homeTeam: "Zonguldak Kömürspor", awayTeam: "Düzcespor" }, { locale: "tr" });
  assert.equal(cup.name, undefined);
  assert.equal(cup.address.addressCountry, "TR");

  const europe = locationOf({ competitionId: "sampiyonlar-ligi", league: "Şampiyonlar Ligi", venue: null }, { locale: "en" });
  assert.equal(europe, null, "UEFA bir stadyum değildir");

  assert.equal(startDateOf("2026-10-07T11:00:00Z"), "2026-10-07T14:00:00+03:00");
  assert.equal(startDateOf("2026-10-07"), "2026-10-07", "saati bilinmeyen güne saat eklenmez");
  assert.equal(sportsEventNode(match({ kickoff: "" })), null);

  const live = sportsEventNode(match({ status: "2H" }));
  assert.equal(live.eventStatus, "https://schema.org/EventScheduled");
  const parsed = validateBlocks([{ "@context": "https://schema.org", ...finished }]);
  assert.deepEqual(parsed.errors, [], parsed.errors.join("; "));
}

function readEvent(relative) {
  const html = fs.readFileSync(path.join(root, relative), "utf8");
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((item) => JSON.parse(item[1]));
  const graph = blocks.flatMap((block) => (block["@graph"] ? block["@graph"] : [block]));
  const event = graph.find((node) => node["@type"] === "SportsEvent");
  assert.ok(event, `${relative}: SportsEvent yok`);
  return event;
}

{
  const tr = readEvent("mac/zonguldak-komurspor-duzcespor-7-ekim-2026.html");
  const en = readEvent("en/match/zonguldak-komurspor-duzcespor-october-7-2026.html");
  assert.equal(tr.eventStatus, undefined, "bitmiş Zonguldak maçı EventScheduled olmamalı");
  assert.equal(en.eventStatus, undefined);
  assert.equal(tr.startDate, "2026-10-07T14:00:00+03:00");
  assert.equal(en.startDate, tr.startDate, "TR ve EN aynı startDate");
  assert.equal(tr.homeTeam.name, "Zonguldak Kömürspor");
  assert.equal(en.homeTeam.name, tr.homeTeam.name);
  assert.equal(tr.awayTeam.name, "Düzcespor");
  assert.equal(en.awayTeam.name, tr.awayTeam.name);
  assert.equal(tr.location.name, undefined, "stat uydurulmamalı");
  assert.equal(en.location.name, undefined);
  assert.equal(tr.location.address.addressCountry, "TR");
  assert.equal(en.location.address.addressCountry, tr.location.address.addressCountry);
  for (const event of [tr, en]) {
    const result = validateBlocks([{ "@context": "https://schema.org", ...event, url: event.url }]);
    assert.deepEqual(result.errors, [], result.errors.join("; "));
  }
}

{
  const registry = JSON.parse(fs.readFileSync(path.join(root, "data/match-seo-pages.json"), "utf8"));
  const withVenue = registry.pages.find((entry) => entry.venue && entry.status === "SCHEDULED" && entry.competitionId === "super-lig" && Date.parse(entry.kickoff) > Date.now());
  const withoutVenue = registry.pages.find((entry) => !entry.venue && entry.competitionId === "turkiye-kupasi" && entry.status === "FINISHED");
  assert.ok(withVenue && withoutVenue, "örnek kayıtlar");
  for (const entry of [withVenue, withoutVenue]) {
    const tr = readEvent(`mac/${entry.slug}.html`);
    const en = readEvent(`en/match/${entry.enSlug}.html`);
    assert.equal(en.startDate, tr.startDate, entry.slug);
    assert.equal(en.eventStatus, tr.eventStatus, entry.slug);
    assert.equal((en.location && en.location.address && en.location.address.addressCountry) || null, (tr.location && tr.location.address && tr.location.address.addressCountry) || null, entry.slug);
    assert.equal(Boolean(en.location && en.location.name), Boolean(tr.location && tr.location.name), entry.slug);
    JSON.parse(JSON.stringify(tr));
    JSON.parse(JSON.stringify(en));
  }
  assert.equal(readEvent(`mac/${withVenue.slug}.html`).eventStatus, "https://schema.org/EventScheduled");
  assert.ok(readEvent(`mac/${withVenue.slug}.html`).location.name);
  assert.equal(readEvent(`mac/${withoutVenue.slug}.html`).eventStatus, undefined);
  assert.equal(readEvent(`mac/${withoutVenue.slug}.html`).location.name, undefined);
  assert.equal(readEvent(`mac/${withoutVenue.slug}.html`).location.address.addressCountry, "TR");
}

console.log("  ok  maç SportsEvent durumu, startDate ve konum");
