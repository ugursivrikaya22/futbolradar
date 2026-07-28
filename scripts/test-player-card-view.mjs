/**
 * OYUNCU KARTI GÖRÜNÜM MODELİ TESTLERİ
 *
 * Kartın sözleşmesi:
 *   1. Ölçülmemiş alan UYDURULMAZ. Değer ya gerçektir ya `awaiting`.
 *   2. Gizlenmiş sayısal alan SIFIR olarak sızmaz. (`Number(null) === 0`
 *      tuzağı: gizlenen gol sayısı "0 gol" diye görünüyordu ve okuyucu bunu
 *      "oynadı, atamadı" diye okurdu.)
 *   3. Güven seviyesi ATANMAZ, ölçülür: kaç çekirdek yuvanın gerçekten
 *      dolduğundan türetilir.
 *   4. Doğrulanmamış kayıt kulüp iddiası taşımaz.
 *   5. Arama dizini yalnızca ölçülmüş değeri yazar; yokluk "bekleniyor"
 *      demektir ve istemci de aynı yuva listesini bilir.
 *   6. Depodaki dizinde yayın kapısının gizlediği hiçbir alan görünmez.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  AWAITING_LABEL,
  CARD_SLOTS,
  buildPlayerCard,
  buildSearchCard
} = require("../services/playerCardView.js");
const { publicPlayerView } = require("../services/cardCredibility.js");

/** Yayın kapısını geçen, sağlayıcıdan senkronlanmış tipik kayıt. */
function providerPlayer(overrides = {}) {
  return {
    id: "t-oyuncu-galatasaray",
    name: "T. Oyuncu",
    position: "Attacker",
    age: 24,
    currentTeam: "Galatasaray",
    team: "Galatasaray",
    providerId: "123456",
    photo: "https://media.api-sports.io/football/players/123456.png",
    providerName: "API-Football",
    sourceUrl: "https://v3.football.api-sports.io/players/squads?player=123456",
    lastVerifiedAt: new Date().toISOString(),
    dataStatus: "provider",
    ...overrides
  };
}

// --- 1. Ölçülmemiş alanlar "bekleniyor" olur, uydurulmaz ---
{
  const card = buildPlayerCard(providerPlayer());

  assert.equal(card.verified, true, "ön koşul: sağlayıcı kaydı yayımlanabilir olmalı");
  assert.equal(card.fields.team.value, "Galatasaray", "doğrulanmış kulüp gösterilmeli");
  assert.equal(card.fields.position.value, "Attacker", "mevki gösterilmeli");
  assert.equal(card.fields.age.value, 24, "yaş gösterilmeli");

  for (const key of ["marketValue", "rating", "goals", "assists"]) {
    assert.equal(card.fields[key].awaiting, true, `${key} ölçülmediği için beklemede olmalı`);
    assert.equal(card.fields[key].value, null, `${key} için değer yazılmamalı`);
    assert.equal(card.fields[key].display, AWAITING_LABEL, `${key} için "${AWAITING_LABEL}" gösterilmeli`);
  }
}

// --- 2. Gizlenen sayısal alan sıfır olarak sızmamalı (regresyon) ---
{
  // Kayıtta sayılar VAR ama yayın kapısı bunları gizliyor (ölçüm kanıtı yok).
  const player = providerPlayer({ goals: 0, assists: 0, minutesPlayed: 0, appearances: 0, overallRating: 61 });
  const view = publicPlayerView(player);

  assert.ok(view.restricted.includes("goals"), "ön koşul: gol alanı yayın kapısınca gizlenmeli");

  const card = buildPlayerCard(player);
  for (const key of ["goals", "assists", "minutes", "appearances", "rating"]) {
    assert.notEqual(card.fields[key].value, 0, `${key} gizliyken sıfır olarak gösterilmemeli`);
    assert.equal(card.fields[key].awaiting, true, `${key} gizliyken beklemede olmalı`);
  }
}

// --- 3. Ölçülmüş bir sıfır gösterilebilmeli ---
{
  // Sağlayıcı gerçekten oynanmışlık gönderdiyse sıfır gol MEŞRU bir ölçümdür
  // ve gizlenmemeli: kural "sıfırı sakla" değil, "ölçülmemişi sakla".
  const player = providerPlayer({ appearances: 12, minutesPlayed: 840, goals: 0, assists: 3 });
  const card = buildPlayerCard(player);

  assert.equal(card.fields.goals.awaiting, false, "ölçülmüş gol sayısı gizlenmemeli");
  assert.equal(card.fields.goals.value, 0, "ölçülmüş sıfır gol olduğu gibi gösterilmeli");
  assert.equal(card.fields.goals.display, "0", "ölçülmüş sıfır için bekleme metni yazılmamalı");
  assert.equal(card.fields.assists.value, 3, "asist sayısı gösterilmeli");
}

// --- 4. Güven seviyesi ölçülür, atanmaz ---
{
  const sparse = buildPlayerCard(providerPlayer());
  const rich = buildPlayerCard(providerPlayer({
    appearances: 20, minutesPlayed: 1500, goals: 9, assists: 4,
    marketValueEur: 12000000, overallRating: 78, ratingStatus: "verified"
  }));

  assert.ok(sparse.confidence.filled < rich.confidence.filled, "daha çok ölçüm taşıyan kart daha çok dolu yuva bildirmeli");
  assert.equal(rich.confidence.level, "high", "çekirdek yuvaları dolu kart yüksek güven olmalı");
  assert.equal(sparse.confidence.level, "medium", "yalnızca kimlik alanı olan doğrulanmış kart orta güven olmalı");
  assert.ok(rich.confidence.label && sparse.confidence.label, "her seviyenin okunur bir etiketi olmalı");
}

// --- 5. Doğrulanmamış kayıt kulüp iddiası taşımaz ---
{
  const player = providerPlayer({ providerId: "mock-t-oyuncu", dataStatus: "manually_verified" });
  const card = buildPlayerCard(player);

  assert.equal(card.verified, false, "yer tutucu sağlayıcı kimliği kaydı doğrulanmamış yapmalı");
  assert.equal(card.confidence.level, "none", "doğrulanmamış kartın güven seviyesi none olmalı");
  assert.equal(card.fields.team.awaiting, true, "doğrulanmamış kayıtta kulüp iddiası gösterilmemeli");
  assert.ok(card.confidence.reasons.length, "eleme gerekçesi taşınmalı");
}

// --- 6. Arama kartı yalnızca ölçülmüş değeri yazar ---
{
  const compact = buildSearchCard(providerPlayer());

  for (const key of Object.keys(compact.values)) {
    assert.ok(CARD_SLOTS.includes(key), `dizine bilinmeyen yuva yazılmamalı: ${key}`);
    assert.notEqual(compact.values[key], null, `dizine null yazılmamalı: ${key}`);
  }
  for (const key of ["marketValue", "rating", "goals"]) {
    assert.ok(!(key in compact.values), `ölçülmemiş ${key} dizine yazılmamalı`);
  }
  assert.equal(compact.verified, true);
  assert.ok(compact.source, "kartın kaynağı taşınmalı");
}

// --- 7. site.js aynı yuva adlarını biliyor ---
{
  // Yuva listesi iki dosyada yaşıyor (servis üretir, istemci çizer). Biri
  // değişip diğeri kalırsa kart sessizce eksik alan gösterir.
  const clientSource = fs.readFileSync("site.js", "utf8");
  const block = clientSource.match(/var CARD_SLOT_LABELS = \{([\s\S]*?)\};/);
  assert.ok(block, "site.js içinde CARD_SLOT_LABELS bulunamadı");

  const clientSlots = [...block[1].matchAll(/^\s*([a-zA-Z]+)\s*:/gm)].map((match) => match[1]);
  for (const slot of CARD_SLOTS) {
    assert.ok(clientSlots.includes(slot), `site.js "${slot}" yuvası için etiket tanımlamıyor`);
  }

  assert.ok(
    clientSource.includes(`"${AWAITING_LABEL}"`),
    `site.js bekleme metnini servisle aynı yazmalı ("${AWAITING_LABEL}")`
  );
}

// --- 8. Depodaki arama dizini yayın kapısına uyuyor ---
{
  const index = JSON.parse(fs.readFileSync("search-index.json", "utf8"));
  const players = JSON.parse(fs.readFileSync("data/players.json", "utf8"));
  const byId = new Map(players.map((player) => [player.id, player]));

  const cards = index.filter((entry) => entry.type === "player");
  assert.ok(cards.length, "dizinde oyuncu kaydı olmalı");

  let checked = 0;
  for (const entry of cards) {
    assert.ok(entry.card, `${entry.title} için kart verisi eksik`);

    const id = String(entry.href || "").replace(/^oyuncular\//, "").replace(/\.html$/, "");
    const player = byId.get(id);
    if (!player) continue;

    const expected = buildSearchCard(player);
    assert.deepEqual(
      entry.card.values,
      expected.values,
      `${entry.title}: dizindeki değerler yayın kapısının sonucuyla aynı olmalı`
    );
    assert.equal(entry.card.verified, expected.verified, `${entry.title}: doğrulama durumu aynı olmalı`);

    // Doğrulanmamış kayıt dizinde kulüp iddiası taşımamalı.
    if (!entry.card.verified) {
      assert.ok(!("team" in entry.card.values), `${entry.title}: doğrulanmamış kayıt kulüp yazmamalı`);
    }
    checked += 1;
  }

  assert.ok(checked > 100, `dizin doğrulaması anlamlı sayıda kayıt kapsamalı, kapsanan: ${checked}`);
}

console.log("Player card view tests passed (uydurma yok, gizli sıfır sızmaz, ölçülmüş sıfır görünür, güven ölçülür, istemci-servis yuva eşliği, dizin uyumu).");
