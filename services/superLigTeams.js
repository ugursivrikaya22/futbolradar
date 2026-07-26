/**
 * SÜPER LİG TAKIM KAPSAMI
 *
 * Sitenin takım listesi iki kaynaktan birleşir:
 *
 *   1. data/teams.json — elle doğrulanmış, zengin editoryal kayıt (momentum,
 *      form, transferler). Bu dosyada yalnızca birkaç takım vardır.
 *   2. data/super-lig-fixtures.json — TFF fikstürü. Bir takımın bu sezon
 *      ligde olduğu doğrulanmış bilgidir; fikstürde adı geçen her takım
 *      gerçekten Süper Lig'dedir.
 *
 * Neden birleştirme: teams.json'da yalnızca beş takım olduğu için "Göztepe"
 * veya "Konyaspor" araması sıfır sonuç veriyordu — oysa iki takım da ligde ve
 * sitede 306 maç sayfasında adı geçiyor. Kapsamı elle 18 kayda çıkarmak yerine
 * fikstürden türetmek tek kaynak bırakır: lig kadrosu değiştiğinde liste
 * kendiliğinden güncellenir.
 *
 * ÖNEMLİ: Fikstürden türetilen takım için YALNIZCA kimlik alanları üretilir
 * (ad, lig, sezon, ülke). momentum, form, hücum/savunma gücü, stadyum, teknik
 * direktör, kadro gibi alanlar UYDURULMAZ; bu takımlarda o alanlar yoktur ve
 * arayüz ilgili bölümleri sessizce gizler.
 */

const fixtures = require("../data/super-lig-fixtures.json");
const { normalizeText } = require("../api/_utils");

function slug(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Fikstürde adı geçen benzersiz takımlar (doğrulanmış lig üyeliği). */
function fixtureTeamNames() {
  const names = new Set();

  for (const round of fixtures.rounds || []) {
    for (const match of round.matches || []) {
      if (match && match.homeTeam) names.add(String(match.homeTeam).trim());
      if (match && match.awayTeam) names.add(String(match.awayTeam).trim());
    }
  }

  return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b, "tr"));
}

/**
 * Fikstürden türetilmiş takım kaydı. Yalnızca doğrulanabilir alanlar taşır.
 * `coverage: "fixture-only"` işareti, arayüzün veri gerektiren bölümleri
 * sessizce gizleyebilmesi için bırakılır.
 */
function fixtureOnlyTeam(name) {
  return {
    id: slug(name),
    name,
    league: fixtures.league || "Süper Lig",
    standingsSeason: fixtures.season || null,
    country: "Türkiye",
    coverage: "fixture-only",
    source: "tff-fixture",
    dataStatus: "verified-identity"
  };
}

/**
 * Editoryal kayıtlar + fikstürden türetilenler. Aynı takım her iki kaynakta
 * varsa editoryal kayıt kazanır: elle doğrulanmış veri, türetilmiş kimliğin
 * üzerine yazılmaz.
 */
function mergeSuperLigTeams(curatedTeams) {
  const merged = [];
  const seen = new Set();

  for (const team of Array.isArray(curatedTeams) ? curatedTeams : []) {
    if (!team || !team.name) continue;
    seen.add(normalizeText(team.name));
    merged.push(team);
  }

  for (const name of fixtureTeamNames()) {
    if (seen.has(normalizeText(name))) continue;
    seen.add(normalizeText(name));
    merged.push(fixtureOnlyTeam(name));
  }

  return merged;
}

/** Bu takım yalnızca fikstürden mi biliniyor (kadro/istatistik yok)? */
function isFixtureOnly(team) {
  return Boolean(team && team.coverage === "fixture-only");
}

module.exports = {
  fixtureTeamNames,
  fixtureOnlyTeam,
  mergeSuperLigTeams,
  isFixtureOnly,
  slug
};
