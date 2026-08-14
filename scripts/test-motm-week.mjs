#!/usr/bin/env node
/**
 * BU HAFTANIN EN ÇOK OY ALANLARI — SÖZLEŞME DENETİMİ.
 *
 * Widget ana sayfada gerçek oy iddia ediyor; testlerin sıkıştırdığı soru
 * anket testleriyle aynı ailedendir:
 *
 *     LİSTEYE GİRMEMESİ GEREKEN BİR ŞEY GİREBİLİR Mİ — bir sayı, bir
 *     fotoğraf, bir bağlantı UYDURULABİLİR Mİ?
 *
 *   • Pencere dışı ya da anket hak etmeyen maçın oyu listeye giremez.
 *   • Sayımda kalmış ama aday listesinde olmayan kimlik süzülür.
 *   • Aynı oyuncunun iki maçtaki oyları TOPLANMAZ.
 *   • Fotoğraf yalnızca lisanslı kaynaktan; çakışan ad takıma ayrışmazsa
 *     eşleşme yok sayılır.
 *   • Rapor bağlantısı yalnızca raporu gerçekten üretilmiş maça konur.
 *   • Depo yoksa/arızalıysa uç nokta "unavailable" der ve widget çizilmez.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

const {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_MATCHES,
  WEEK_WINDOW_MS,
  abbreviatedKey,
  buildPhotoIndex,
  logoFor,
  photoFor,
  reportHrefFor,
  selectWeeklyTopPlayers,
  teamsMatch,
  weeklyPollMatches
} = require("../services/motmWeekly.js");
// Aday kimlikleri servisin KENDİ katlamasıyla üretilir; elle yazılan kimlik
// Türkçe harflerde ayrışır ve test yanlış şeyi sınar.
const { foldName } = require("../services/motmPoll.js");
const ID = { dogan: foldName("Doğan Alemdar"), ridvan: foldName("Rıdvan Yılmaz"), abir: foldName("A. Bir") };

const NOW = Date.parse("2026-08-14T12:00:00+03:00");
const HOUR_MS = 60 * 60 * 1000;

/** Anket hak eden sentetik maç; kickoff NOW'a göre saat cinsinden verilir. */
function match(id, hoursAgo, overrides = {}) {
  return {
    id,
    status: "FINISHED",
    kickoff: new Date(NOW - hoursAgo * HOUR_MS).toISOString(),
    homeTeam: "Beşiktaş",
    awayTeam: "FC Midtjylland",
    score: { home: 2, away: 1 },
    lineups: [
      { team: "Beşiktaş", players: ["Doğan Alemdar", "Rıdvan Yılmaz"] },
      { team: "FC Midtjylland", players: ["A. Bir", "B. İki"] }
    ],
    substitutions: [],
    ...overrides
  };
}

console.log("motm-week");

// ── 1. Haftalık pencere: yalnızca son 7 günün anket maçları ────────────────
{
  const list = [
    match("taze-mac", 20),
    match("eski-mac", 8 * 24),                                  // 8 gün önce: pencere dışı
    match("bitmemis-mac", 5, { status: "LIVE" }),               // anket hak etmiyor
    match("yabanci-mac", 6, { homeTeam: "Arsenal", awayTeam: "Chelsea" }),
    match("gelecek-mac", -4)                                    // saat hatalı kayıt: gelecekte
  ];
  const picked = weeklyPollMatches(list, { now: NOW }).map((entry) => entry.poll.matchId);
  assert.deepEqual(picked, ["taze-mac"], "yalnızca pencere içindeki anket maçı seçilmeli");

  // En yeni önce; taşan eskiler düşer (sayım okuması sınırlı kalmalı).
  const many = Array.from({ length: MAX_MATCHES + 5 }, (_, i) => match(`mac-${i}`, i + 1));
  const capped = weeklyPollMatches(many, { now: NOW });
  assert.equal(capped.length, MAX_MATCHES, "sayım okuması MAX_MATCHES ile sınırlı olmalı");
  assert.equal(capped[0].poll.matchId, "mac-0", "en yeni maç önce gelmeli");
}

// ── 2. Sayım süzülür: aday listesinde olmayan kimlik listeye giremez ───────
{
  const result = selectWeeklyTopPlayers({
    matches: [match("mac-a", 10)],
    tallies: { "mac-a": { [ID.dogan]: 6, [ID.ridvan]: 3, "uydurma-oyuncu": 99, [ID.abir]: 1 } },
    players: [], teams: [], reports: {}
  }, { now: NOW });

  assert.equal(result.matchCount, 1);
  assert.equal(result.totalVotes, 10, "geçersiz kimlik toplama girmemeli");
  const names = result.players.map((row) => row.name);
  assert.ok(!names.some((name) => /uydurma/i.test(name)), "aday olmayan kimlik listeye girmiş");

  // Yüzde MAÇ İÇİ paydır ve mutlak oyla birlikte verilir.
  const top = result.players[0];
  assert.equal(top.name, "Doğan Alemdar");
  assert.equal(top.votes, 6);
  assert.equal(top.percent, 60);
  assert.equal(top.matchVotes, 10);
  assert.equal(top.matchLabel, "Beşiktaş 2-1 FC Midtjylland");

  // Sayımı olmayan maç satır üretmez; "0 oy" diye bir satır yoktur.
  const empty = selectWeeklyTopPlayers({
    matches: [match("mac-b", 10)], tallies: {}, players: [], teams: [], reports: {}
  }, { now: NOW });
  assert.equal(empty.players.length, 0);
  assert.equal(empty.matchCount, 0);
}

// ── 3. Aynı oyuncu iki maçta: satırlar TOPLANMAZ, en iyisi kalır ───────────
{
  const result = selectWeeklyTopPlayers({
    matches: [match("mac-a", 10), match("mac-b", 30)],
    tallies: {
      "mac-a": { [ID.dogan]: 4, [ID.ridvan]: 1 },
      "mac-b": { [ID.dogan]: 9, [ID.ridvan]: 2 }
    },
    players: [], teams: [], reports: {}
  }, { now: NOW });

  const rows = result.players.filter((row) => row.name === "Doğan Alemdar");
  assert.equal(rows.length, 1, "aynı oyuncu iki satır olmamalı");
  assert.equal(rows[0].votes, 9, "en çok oy aldığı maç kalmalı");
  assert.equal(rows[0].matchId, "mac-b");
  assert.equal(result.totalVotes, 16, "toplam oy tüm maçların gerçek toplamı olmalı");

  // Sıralama: oy, sonra pay, sonra ad.
  const votes = result.players.map((row) => row.votes);
  assert.deepEqual(votes, [...votes].sort((a, b) => b - a), "liste oya göre inmeli");
}

// ── 4. Liste sınırı ────────────────────────────────────────────────────────
{
  const lineups = [{ team: "Beşiktaş", players: Array.from({ length: 15 }, (_, i) => `Oyuncu ${i} Soyad`) }];
  const counts = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [foldName(`Oyuncu ${i} Soyad`), i + 1]));
  const sources = {
    matches: [match("mac-a", 10, { lineups })],
    tallies: { "mac-a": counts }, players: [], teams: [], reports: {}
  };

  assert.equal(selectWeeklyTopPlayers(sources, { now: NOW }).players.length, DEFAULT_LIMIT);
  assert.equal(selectWeeklyTopPlayers(sources, { now: NOW, limit: 3 }).players.length, 3);
  assert.equal(selectWeeklyTopPlayers(sources, { now: NOW, limit: 99 }).players.length, MAX_LIMIT,
    "üst sınır aşılmamalı");
}

// ── 5. Fotoğraf: lisanslı kaynak, çakışmada takım ayrıştırır ───────────────
{
  assert.equal(abbreviatedKey("Doğan Alemdar"), "d-alemdar", "kadro adı kısaltmaya katlanmalı");

  const players = [
    { name: "D. Alemdar", team: "Beşiktaş", photo: "https://media.api-sports.io/football/players/1.png" },
    { name: "Victor Osimhen", team: "Galatasaray", photo: "https://media.api-sports.io/football/players/2.png" },
    // Çakışan kısaltma: iki farklı kulüpte "d-cakir".
    { name: "D. Çakır", team: "Kasımpaşa", photo: "https://media.api-sports.io/football/players/3.png" },
    { name: "D. Çakır", team: "Rizespor", photo: "https://media.api-sports.io/football/players/4.png" },
    // Lisanssız adres: beyaz listeden geçemez.
    { name: "K. Korsan", team: "Beşiktaş", photo: "https://ornek-kazima.com/foto.png" }
  ];
  const index = buildPhotoIndex(players);

  assert.equal(photoFor(index, "Doğan Alemdar", "Beşiktaş").url,
    "https://media.api-sports.io/football/players/1.png", "kısaltılmış ad takımla eşleşmeli");
  assert.equal(photoFor(index, "Victor Osimhen", "Galatasaray").url,
    "https://media.api-sports.io/football/players/2.png", "tam ad doğrudan eşleşmeli");

  // Takıma ayrışmayan çakışma eşleşme DEĞİLDİR: yanlış yüz basılmaz.
  const ambiguous = photoFor(index, "Deniz Çakır", "");
  assert.equal(ambiguous.url, "", "çakışan ad fotoğraf almamalı");
  assert.ok(ambiguous.initials, "yer tutucu baş harf taşımalı");

  // Lisanssız adres fotoğraf olarak dönemez.
  assert.equal(photoFor(index, "Kaan Korsan", "Beşiktaş").url, "", "beyaz liste dışı adres kullanılmamalı");
}

// ── 6. Kulüp logosu: yalnızca gerçek sağlayıcı kimliğinden ─────────────────
{
  const teams = [
    { name: "Beşiktaş", providerId: "549" },
    { name: "Kimliksiz Kulüp", providerId: "mock-1" }
  ];
  assert.equal(logoFor(teams, "Beşiktaş"), "https://media.api-sports.io/football/teams/549.png");
  assert.equal(logoFor(teams, "Kimliksiz Kulüp"), "", "yer tutucu kimlikten logo türetilmemeli");
  assert.equal(logoFor(teams, "Hradec Králové"), "", "bilinmeyen kulübe logo uydurulmamalı");
}

// ── 7. Rapor bağlantısı: yalnızca raporu üretilmiş maça ────────────────────
{
  const reports = {
    records: [
      { matchId: "besiktas-fc-midtjylland-2026-08-12", kickoff: "2026-08-12T21:00:00+03:00",
        homeTeam: "Beşiktaş", awayTeam: "FC Midtjylland" }
    ]
  };

  // Birebir kimlik.
  assert.equal(
    reportHrefFor(reports, { id: "besiktas-fc-midtjylland-2026-08-12", kickoff: "2026-08-12T21:00:00+03:00" }),
    "/mac-raporu/besiktas-fc-midtjylland-2026-08-12.html");

  // Kimlikler ayrışsa da aynı günün aynı iki takımı: küratörlü kimlik
  // sağlayıcı kimliğine köprülenir.
  assert.equal(
    reportHrefFor(reports, {
      id: "besiktas-midtjylland-2026-08-12", kickoff: "2026-08-12T21:00:00+03:00",
      homeTeam: "Beşiktaş", awayTeam: "Midtjylland"
    }),
    "/mac-raporu/besiktas-fc-midtjylland-2026-08-12.html");

  // Raporu olmayan maça bağlantı verilmez — kırık söz olurdu.
  assert.equal(reportHrefFor(reports, { id: "raporu-yok-mac", kickoff: "2026-08-12T21:00:00+03:00" }), "");
  assert.equal(reportHrefFor(reports, {
    id: "baska-gun", kickoff: "2026-08-10T21:00:00+03:00",
    homeTeam: "Beşiktaş", awayTeam: "Midtjylland"
  }), "", "başka günün raporuna köprülenmemeli");

  // Takım eşleştirme kelime sınırlıdır; kısa parçalar her kulüple eşleşmez.
  assert.equal(teamsMatch("FC Midtjylland", "Midtjylland"), true);
  assert.equal(teamsMatch("Beşiktaş", "Besiktas"), true);
  assert.equal(teamsMatch("FC", "Fenerbahçe"), false);
  assert.equal(teamsMatch("Amed", "Amed Sportif Faaliyetler"), true);
}

// ── 8. Uç nokta: depo yoksa/arızalıysa widget'a "unavailable" denir ────────
{
  const STORE_PATH = path.join(root, "services", "motmVoteStore.js");
  const WEEK_ROUTE_PATH = path.join(root, "server", "motmWeekRoute.js");
  const VOTE_ROUTE_PATH = path.join(root, "server", "motmVoteRoute.js");
  const API_PATH = path.join(root, "api", "[...route].js");
  const MATCHES_PATH = path.join(root, "data", "matches.json");

  const originalMatches = require.cache[MATCHES_PATH];
  const fakeMatches = [match("hafta-mac", 10, {
    kickoff: new Date(Date.now() - 10 * HOUR_MS).toISOString()
  })];

  function installHandler(options = {}) {
    require.cache[MATCHES_PATH] = { id: MATCHES_PATH, filename: MATCHES_PATH, loaded: true, exports: fakeMatches };
    const fake = {
      ...require(STORE_PATH),
      isConfigured: () => options.configured !== false,
      readTally: async () => {
        if (options.throws) throw new Error("store-down");
        return options.counts || {};
      }
    };
    require.cache[STORE_PATH] = { id: STORE_PATH, filename: STORE_PATH, loaded: true, exports: fake };
    delete require.cache[WEEK_ROUTE_PATH];
    delete require.cache[VOTE_ROUTE_PATH];
    delete require.cache[API_PATH];
    return require(API_PATH);
  }

  function invoke(handler, { method = "GET", url = "/api/motm-week" } = {}) {
    const req = { method, url, headers: {} };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      end(payload) { this.body = payload; return this; }
    };
    return Promise.resolve(handler(req, res)).then(() => ({
      status: res.statusCode,
      headers: res.headers,
      payload: res.body ? JSON.parse(res.body) : null
    }));
  }

  // Depo yok: kapalı, uydurma değil.
  const offline = await invoke(installHandler({ configured: false }));
  assert.equal(offline.status, 200);
  assert.equal(offline.payload.data.storage, "unavailable");
  assert.deepEqual(offline.payload.data.players, [], "kapalıyken oyuncu uydurulmamalı");

  // Depo arızası ana sayfayı kırmaz.
  const broken = await invoke(installHandler({ throws: true }));
  assert.equal(broken.status, 200);
  assert.equal(broken.payload.data.storage, "unavailable");

  // Gerçek sayım: hazır yanıt, kısa CDN önbelleği, sınırlı liste.
  const ready = await invoke(installHandler({ counts: { [ID.dogan]: 5, [ID.ridvan]: 2 } }));
  assert.equal(ready.payload.data.storage, "ready");
  assert.equal(ready.payload.data.players.length, 2);
  assert.equal(ready.payload.data.players[0].name, "Doğan Alemdar");
  assert.equal(ready.payload.data.players[0].percent, 71);
  assert.equal(ready.payload.data.windowDays, 7);
  assert.match(String(ready.headers["cdn-cache-control"] || ""), /s-maxage=60/,
    "haftalık liste kısa CDN önbelleği almalı");

  // Yalnızca GET.
  const posted = await invoke(installHandler({}), { method: "POST" });
  assert.equal(posted.status, 405);

  // Temizlik: sonraki testler gerçek veriyi görsün.
  if (originalMatches) require.cache[MATCHES_PATH] = originalMatches;
  else delete require.cache[MATCHES_PATH];
  delete require.cache[STORE_PATH];
  delete require.cache[WEEK_ROUTE_PATH];
  delete require.cache[VOTE_ROUTE_PATH];
  delete require.cache[API_PATH];
}

// ── 9. Ana sayfa ve istemci sözleşmesi ─────────────────────────────────────
//
// Bölüm `hidden` doğar ve yalnızca istemci GERÇEK sayım bulursa açılır.
// Kancalardan biri yeniden adlandırılırsa widget sessizce ölür — bu yüzden
// sözleşme burada sabitleniyor (anketin 9. bölümüyle aynı gerekçe).
{
  for (const page of ["index.html", path.join("public", "index.html")]) {
    const html = fs.readFileSync(path.join(root, page), "utf8");
    assert.match(html, /<section[^>]*data-motm-week[^>]*hidden>/, `${page}: widget hidden doğmalı`);
    assert.ok(html.includes("Bu Haftanın En Çok Oy Alan Oyuncuları"), `${page}: başlık basılı olmalı`);
    assert.ok(html.includes("data-motm-week-list"), `${page}: liste kancası olmalı`);
    assert.equal((html.match(/data-motm-week-source/g) || []).length, 1, `${page}: widget bir kez basılmalı`);
  }

  const client = fs.readFileSync(path.join(root, "site.js"), "utf8");
  for (const hook of ["data-motm-week", "data-motm-week-list", "/api/motm-week", 'storage === "ready"']) {
    assert.ok(client.includes(hook), `site.js "${hook}" kancasını kaybetmiş`);
  }
  // Görsel yüklenemezse baş harfe düşülmeli; kırık görsel bırakılmaz.
  assert.match(client, /addEventListener\("error"/, "istemci görsel hatasını ele almalı");

  const css = fs.readFileSync(path.join(root, "page.css"), "utf8");
  for (const selector of [".motm-week__card", ".motm-week__bar-fill", ".motm-week__club"]) {
    assert.ok(css.includes(selector), `page.css "${selector}" seçicisini kaybetmiş`);
  }
  assert.ok(/prefers-reduced-motion[^}]*\{[^{]*\.motm-week/s.test(css) ||
    css.includes(".motm-week__bar-fill { transition: none; }"),
    "animasyonlar reduced-motion'a uymalı");
}

// ── 10. ANKET SAYFASI KİPİ: scope=matches ─────────────────────────────────
//
// Anket sayfası maç anketlerini de listeliyor. Buradaki tek soru:
// TIKLANDIĞINDA 404 VEREN BİR BAĞLANTI ÜRETİLEBİLİR Mİ?
//
// Bağlantı tahmin edilmiyor: `data/motm-poll-pages.json` enjektör
// tarafından yazılıyor ve gerçekten anket basılmış sayfayı taşıyor.
// Eşlemede olmayan maç listeye girmemeli.
{
  const STORE_PATH = path.join(root, "services", "motmVoteStore.js");
  const WEEK_ROUTE_PATH = path.join(root, "server", "motmWeekRoute.js");
  const VOTE_ROUTE_PATH = path.join(root, "server", "motmVoteRoute.js");
  const API_PATH = path.join(root, "api", "[...route].js");
  const MATCHES_PATH = path.join(root, "data", "matches.json");
  const PAGES_PATH = path.join(root, "data", "motm-poll-pages.json");

  const originalMatches = require.cache[MATCHES_PATH];
  const originalPages = require.cache[PAGES_PATH];

  // İki anket hak eden maç: biri eşlemede VAR, biri YOK.
  const linkedMatch = match("baglantili-mac", 30);
  const orphanMatch = match("eslemede-olmayan-mac", 40);

  function installHandler(options = {}) {
    require.cache[MATCHES_PATH] = {
      id: MATCHES_PATH, filename: MATCHES_PATH, loaded: true,
      exports: [linkedMatch, orphanMatch]
    };
    require.cache[PAGES_PATH] = {
      id: PAGES_PATH, filename: PAGES_PATH, loaded: true,
      exports: { pages: { "baglantili-mac": "mac-raporu/baglantili-mac.html" } }
    };
    const fake = {
      ...require(STORE_PATH),
      isConfigured: () => options.configured !== false,
      readTally: async () => {
        if (options.throws) throw new Error("store-down");
        return options.counts || {};
      }
    };
    require.cache[STORE_PATH] = { id: STORE_PATH, filename: STORE_PATH, loaded: true, exports: fake };
    delete require.cache[WEEK_ROUTE_PATH];
    delete require.cache[VOTE_ROUTE_PATH];
    delete require.cache[API_PATH];
    return require(API_PATH);
  }

  function invoke(handler, url = "/api/motm-week?scope=matches") {
    const req = { method: "GET", url, headers: {} };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      end(payload) { this.body = payload; return this; }
    };
    return Promise.resolve(handler(req, res)).then(() => ({
      status: res.statusCode,
      headers: res.headers,
      payload: res.body ? JSON.parse(res.body) : null
    }));
  }

  // EŞLEMEDE OLMAYAN MAÇ LİSTEYE GİRMEZ.
  {
    const response = await invoke(installHandler({ counts: { [ID.dogan]: 7, [ID.ridvan]: 3 } }));
    assert.equal(response.status, 200);
    assert.equal(response.payload.data.matches.length, 1, "yalnızca eşlemedeki maç listelenmeli");

    const row = response.payload.data.matches[0];
    assert.equal(row.matchId, "baglantili-mac");
    assert.equal(row.href, "/mac-raporu/baglantili-mac.html", "bağlantı eşlemeden gelmeli");
    assert.equal(row.matchLabel, "Beşiktaş 2-1 FC Midtjylland");
    assert.equal(row.total, 10);
    assert.equal(row.leader.name, "Doğan Alemdar");
    assert.equal(row.leader.percent, 70);
  }

  // BERABERLİKTE LİDER YOK: eşitken birini öne koymak veride olmayan bir
  // sıra uydurmaktır (ana sayfa anketindeki kuralın aynısı).
  {
    const response = await invoke(installHandler({ counts: { [ID.dogan]: 4, [ID.ridvan]: 4 } }));
    const row = response.payload.data.matches[0];
    assert.equal(row.total, 8);
    assert.equal(row.leader, null, "beraberlikte lider bildirilmemeli");
  }

  // Sayımda kalmış geçersiz kimlik toplama girmez.
  {
    const response = await invoke(installHandler({ counts: { [ID.dogan]: 5, "uydurma-oyuncu": 99 } }));
    assert.equal(response.payload.data.matches[0].total, 5, "aday olmayan kimlik toplama girmiş");
  }

  // DEPO KAPALIYKEN ANKETLERİN VARLIĞI YİNE BİLDİRİLİR: okuyucu maç
  // sayfasına gidip oy verebilir. Yalnızca sayım gösterilmez.
  {
    const response = await invoke(installHandler({ configured: false }));
    assert.equal(response.payload.data.storage, "unavailable");
    assert.equal(response.payload.data.matches.length, 1, "depo kapalıyken de anket listelenmeli");
    assert.equal(response.payload.data.matches[0].total, 0);
    assert.equal(response.payload.data.matches[0].leader, null, "sayım yokken lider uydurulmamalı");
  }

  // Depo arızası sayfayı kırmaz.
  {
    const response = await invoke(installHandler({ throws: true }));
    assert.equal(response.status, 200);
    assert.equal(response.payload.data.storage, "unavailable");
    assert.equal(response.payload.data.matches.length, 1);
  }

  // Varsayılan kip (oyuncu sıralaması) depo kapalıyken HİÇ liste vermez:
  // sıralama gerçek sayım olmadan anlamsız.
  {
    const response = await invoke(installHandler({ configured: false }), "/api/motm-week");
    assert.equal(response.payload.data.storage, "unavailable");
    assert.deepEqual(response.payload.data.players, []);
  }

  if (originalMatches) require.cache[MATCHES_PATH] = originalMatches;
  else delete require.cache[MATCHES_PATH];
  if (originalPages) require.cache[PAGES_PATH] = originalPages;
  else delete require.cache[PAGES_PATH];
  delete require.cache[STORE_PATH];
  delete require.cache[WEEK_ROUTE_PATH];
  delete require.cache[VOTE_ROUTE_PATH];
  delete require.cache[API_PATH];
}

// ── 11. Eşleme dosyası enjektörle tutarlı ─────────────────────────────────
//
// `data/motm-poll-pages.json` üretilen bir dosya; elle düzenlenirse ya da
// enjektörle ayrışırsa anket sayfası var olmayan sayfalara bağlanır.
{
  const payload = JSON.parse(fs.readFileSync(path.join(root, "data", "motm-poll-pages.json"), "utf8"));
  const pages = payload.pages || {};
  const ids = Object.keys(pages);
  assert.ok(ids.length > 0, "eşlemede en az bir anket sayfası olmalı");

  for (const [matchId, page] of Object.entries(pages)) {
    // Hedef sayfa GERÇEKTEN var mı ve anketi taşıyor mu?
    const file = path.join(root, page);
    assert.ok(fs.existsSync(file), `${page}: eşlemedeki sayfa yok`);
    const html = fs.readFileSync(file, "utf8");
    assert.ok(html.includes("data-motm-poll"), `${page}: eşlemede ama ankete sahip değil`);
    assert.ok(html.includes(`data-motm-match="${matchId}"`), `${page}: başka maçın anketini taşıyor`);
  }

  // Ters yön: anketi olan her sayfa eşlemede mi?
  const withPoll = [];
  for (const dir of ["mac", "mac-raporu", "analiz"]) {
    const absolute = path.join(root, dir);
    if (!fs.existsSync(absolute)) continue;
    for (const name of fs.readdirSync(absolute)) {
      if (!name.endsWith(".html")) continue;
      if (fs.readFileSync(path.join(absolute, name), "utf8").includes("data-motm-poll")) {
        withPoll.push(name.replace(/\.html$/, ""));
      }
    }
  }
  for (const matchId of withPoll) {
    assert.ok(pages[matchId], `${matchId}: anketi var ama eşlemede yok`);
  }
  assert.equal(ids.length, withPoll.length, "eşleme ile basılı anket sayısı tutmalı");
}

console.log("motm-week OK (11 bölüm)");
