/**
 * Kariyer kulüpleri: tekrar eden kulüpte dönem, kiralık işareti, yazımdan
 * bağımsız kulüp kimliği, Türkçe transfer türü.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { careerClubList, player360Bio, renderPlayer360 } from "./lib/player360.mjs";
import { turkishPlayer360, transferTypeTr } from "./lib/player360English.mjs";

const require = createRequire(import.meta.url);
const { buildCareer } = require("../services/player360Service.js");
const { clubKey } = require("../services/turkishNames.js");

function check(name, fn) {
  fn();
  console.log(`ok - ${name}`);
}

const history = [
  { date: "2017-07-01", fromTeam: "Ajax", toTeam: "Galatasaray", type: "Transfer" },
  { date: "2021-07-10", fromTeam: "Galatasaray", toTeam: "Leicester", type: "Loan" },
  { date: "2022-07-01", fromTeam: "Leicester", toTeam: "Galatasaray", type: "Back from Loan" }
];
const player = { id: "p1", name: "Test Oyuncu", transferHistory: history, formerTeams: [] };

check("kulüp kimliği yazımdan bağımsız", () => {
  assert.equal(clubKey("Istanbul Basaksehir"), clubKey("İstanbul Başakşehir"));
  assert.equal(clubKey("Başakşehir"), clubKey("Istanbul Basaksehir"));
  assert.equal(clubKey("Çaykur Rizespor"), clubKey("Rizespor"));
  assert.equal(clubKey("Besiktas"), clubKey("Beşiktaş"));
  assert.notEqual(clubKey("Galatasaray"), clubKey("Fenerbahçe"));
});

check("kiralık dönem işaretlenir, kiralıktan dönüş kiralık sayılmaz", () => {
  const career = buildCareer(player);
  const chronological = career.stints.slice().reverse();
  assert.deepEqual(chronological.map((s) => [s.club, s.loan]), [["Galatasaray", false], ["Leicester", true], ["Galatasaray", false]]);
});

check("tekrar eden kulüpte dönem, kiralıkta işaret: kullanıcı örneği", () => {
  const career = buildCareer(player);
  assert.deepEqual(
    careerClubList(career.stints, { locale: "tr" }),
    ["Galatasaray (2017–2021)", "Leicester (kiralık)", "Galatasaray"]
  );
  assert.deepEqual(
    careerClubList(career.stints, { locale: "en" }),
    ["Galatasaray (2017–2021)", "Leicester (loan)", "Galatasaray"]
  );
});

check("tek geçişte dönem yazılmaz", () => {
  const career = buildCareer({ ...player, transferHistory: [
    { date: "2019-07-01", fromTeam: "A", toTeam: "Konyaspor", type: "Transfer" },
    { date: "2021-07-01", fromTeam: "Konyaspor", toTeam: "Rizespor", type: "Loan" }
  ] });
  assert.deepEqual(careerClubList(career.stints, { locale: "tr" }), ["Konyaspor", "Rizespor (kiralık)"]);
});

check("ASCII ve doğru yazım aynı kulüp: tek dönem, çift kayıt yok", () => {
  const career = buildCareer({ ...player, transferHistory: [
    { date: "2019-07-01", fromTeam: "A", toTeam: "Istanbul Basaksehir", type: "Transfer" },
    { date: "2020-01-01", fromTeam: "Istanbul Basaksehir", toTeam: "Başakşehir", type: "Transfer" }
  ] });
  assert.equal(career.stints.length, 1);
});

check("aynı kulüp listede tek yazımla görünür", () => {
  const career = buildCareer({ ...player, transferHistory: [
    { date: "2019-07-01", fromTeam: "A", toTeam: "Istanbul Basaksehir", type: "Transfer" },
    { date: "2020-07-01", fromTeam: "Istanbul Basaksehir", toTeam: "Rizespor", type: "Loan" },
    { date: "2021-07-01", fromTeam: "Rizespor", toTeam: "Başakşehir", type: "Back from Loan" }
  ] });
  const list = careerClubList(career.stints, { locale: "tr" });
  assert.deepEqual(list, ["Istanbul Basaksehir (2019–2020)", "Rizespor (kiralık)", "Istanbul Basaksehir"]);
});

check("'Daha önce' cümlesi dönem ve kiralık taşır; güncel kulüp tekrar edilmez", () => {
  const career = buildCareer(player);
  const model = {
    verified: true,
    identity: { name: "Test Oyuncu", team: "Galatasaray", position: "Forvet" },
    career
  };
  const bio = player360Bio(model, { locale: "tr" });
  assert.match(bio.text, /Daha önce Galatasaray \(2017–2021\), Leicester \(kiralık\) kulüplerinde forma giydi\./);
  assert.ok(!/Leicester \(kiralık\), Galatasaray[ .]/.test(bio.text), "güncel kulüp sona eklenmemeli");
});

check("transfer türü Türkçe sayfada Türkçe", () => {
  assert.equal(transferTypeTr("Loan"), "Kiralık");
  assert.equal(transferTypeTr("Back from Loan"), "Kiralıktan dönüş");
  assert.equal(transferTypeTr("Return from loan"), "Kiralıktan dönüş");
  assert.equal(transferTypeTr("€ 2.8M"), "€ 2.8M");
  const model = turkishPlayer360({ identity: {}, career: { stints: [{ club: "X", type: "Loan" }], formerTeams: [] } });
  assert.equal(model.career.stints[0].type, "Kiralık");
});

check("kariyer bölümü kulüp yolunu basar; tek dönemde basmaz", () => {
  const { buildPlayer360 } = require("../services/player360Service.js");
  const build = (transferHistory) => {
    const subject = { id: "p1", name: "Test Oyuncu", position: "Forward", team: "Galatasaray", currentTeam: "Galatasaray", transferHistory, formerTeams: [] };
    return turkishPlayer360(buildPlayer360({ player: subject, players: [], transfers: [], news: [], matches: [], archive: [] }));
  };
  const html = renderPlayer360(build(history), { locale: "tr" });
  assert.ok(html.includes("Kulüp yolu: Galatasaray (2017–2021), Leicester (kiralık), Galatasaray"), "yol satırı eksik");
  assert.ok(html.includes("Kiralık"), "tip sütunu Türkçe olmalı");
  assert.ok(!/>Loan<|Back from Loan/.test(html), "İngilizce transfer türü kalmamalı");
  const single = renderPlayer360(build([history[0]]), { locale: "tr" });
  assert.ok(!single.includes("Kulüp yolu"), "tek dönemde yol satırı basılmamalı");
});
