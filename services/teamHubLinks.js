const { TEAM_PAGE_TABLE, teamPageSlug } = require("./superLigTeamPages.js");

// Görev 6: "maçları" sayfaları 18 Süper Lig takımının hepsinde var
// (generate-team-match-pages, services/superLigTeamPages.js listesi).
const TEAM_HUBS = new Set(TEAM_PAGE_TABLE.map((entry) => entry.slug));

function teamHubFile(teamName) {
  const teamSlug = teamPageSlug(teamName);
  return teamSlug && TEAM_HUBS.has(teamSlug) ? `${teamSlug}-maclari.html` : null;
}

function teamHubHref(teamName, base = "./") {
  const file = teamHubFile(teamName);
  return file ? `${base}${file}` : null;
}

/**
 * TAKIM BAĞLANTISI (takim-detay geçişi). Süper Lig takımı → indekslenen
 * takım profili `takimlar/<slug>` (temiz adres); değilse (yabancı kulüp,
 * sayfası yok) noindex `takim-detay.html?team=` olduğu gibi kalır.
 */
function teamProfileHref(teamName, base = "./") {
  const teamSlug = teamPageSlug(teamName);
  return teamSlug
    ? `${base}takimlar/${teamSlug}`
    : `${base}takim-detay.html?team=${encodeURIComponent(teamName || "")}`;
}

module.exports = { TEAM_HUBS, teamHubFile, teamHubHref, teamProfileHref };
