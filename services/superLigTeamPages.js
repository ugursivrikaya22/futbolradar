"use strict";

/**
 * SÜPER LİG TAKIM SAYFALARI İÇİN TEK TAKIM LİSTESİ (Görev 6).
 *
 * Takım/maçları/puan durumu üreticilerindeki sabit "büyük 4" listeleri
 * yerine buradan okunur. Slug'lar ELLE ONAYLI tablodadır: bir adres
 * yayımlandıktan sonra değişmemeli, o yüzden addan otomatik türetilmez.
 * Büyük 4'ün slug'ları mevcut sayfalarla birebir aynıdır.
 *
 * `id` data/teams.json kaydının kimliğidir (puan/sıra verisi oradan).
 * Takım bu sezon teams.json'da yoksa listeden düşer — sayfa uydurulmaz.
 */
const fs = require("node:fs");
const path = require("node:path");

const TEAM_PAGE_TABLE = Object.freeze([
  { slug: "galatasaray", id: "galatasaray", name: "Galatasaray", big: true },
  { slug: "fenerbahce", id: "fenerbahce", name: "Fenerbahçe", big: true },
  { slug: "besiktas", id: "besiktas", name: "Beşiktaş", big: true },
  { slug: "trabzonspor", id: "trabzonspor", name: "Trabzonspor", big: true },
  { slug: "samsunspor", id: "samsunspor", name: "Samsunspor" },
  { slug: "basaksehir", id: "564", name: "Başakşehir" },
  { slug: "konyaspor", id: "607", name: "Konyaspor" },
  { slug: "goztepe", id: "994", name: "Göztepe" },
  { slug: "alanyaspor", id: "996", name: "Alanyaspor" },
  { slug: "genclerbirligi", id: "997", name: "Gençlerbirliği" },
  { slug: "kasimpasa", id: "1004", name: "Kasımpaşa" },
  { slug: "rizespor", id: "1007", name: "Rizespor" },
  { slug: "erzurumspor", id: "1009", name: "Erzurumspor" },
  { slug: "gaziantep-fk", id: "3573", name: "Gaziantep FK" },
  { slug: "amed", id: "3579", name: "Amed" },
  { slug: "eyupspor", id: "3588", name: "Eyüpspor" },
  { slug: "corum-fk", id: "6343", name: "Çorum FK" },
  { slug: "kocaelispor", id: "7411", name: "Kocaelispor" }
]);

function readTeams(root) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, "data", "teams.json"), "utf8"));
    return Array.isArray(raw) ? raw : (raw.teams || []);
  } catch {
    return [];
  }
}

/**
 * Bu sezon Süper Lig'de olan (teams.json'da kaydı bulunan) takımların sayfa
 * kimlikleri: `{ slug, id, name, big, record }`. Sıra tablodaki sıradır.
 */
function superLigTeamPages({ root = path.join(__dirname, ".."), teams } = {}) {
  const list = teams || readTeams(root);
  const byId = new Map(list.map((team) => [String(team.id), team]));
  return TEAM_PAGE_TABLE
    .map((entry) => ({ ...entry, record: byId.get(entry.id) || null }))
    .filter((entry) => entry.record && (!entry.record.league || entry.record.league === "Süper Lig"));
}

/** Takım adı/kimliğinden sayfa slug'ı; Süper Lig takımı değilse null. */
function teamPageSlug(nameOrId, options) {
  const { sameClub } = require("./superLigTeams");
  const key = String(nameOrId || "");
  if (!key) return null;
  for (const entry of superLigTeamPages(options)) {
    if (entry.id === key || entry.slug === key) return entry.slug;
    if (sameClub(entry.name, key) || sameClub(entry.record.name, key)) return entry.slug;
  }
  return null;
}

/**
 * Puan durumu sayfası için ince içerik eşiği: takımın tabloda gerçek satırı
 * (sıra + puan) ve en az MIN_PLAYED oynanmış lig maçı olmalı. Eşiğin
 * altındaki sayfa `noindex,follow` basılır ve site haritasına girmez.
 */
const MIN_PLAYED = 3;
function standingsPageIndexable(record) {
  return Boolean(record)
    && Number(record.played) >= MIN_PLAYED
    && record.rank !== null && record.rank !== undefined
    && record.points !== null && record.points !== undefined;
}

module.exports = { TEAM_PAGE_TABLE, MIN_PLAYED, superLigTeamPages, teamPageSlug, standingsPageIndexable };
