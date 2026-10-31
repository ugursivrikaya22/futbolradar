/**
 * iddaa kapsamı — config/iddaa-leagues.json'un tek okuyucusu.
 * "not-iddaa" ligler: noindex,follow, sitemap dışı, API senkronu kapalı.
 * "iddaa" ve "belirsiz" (muhafazakâr) ligler indekslenir ve senkronlanır.
 * Katalogda olup config'te olmayan lig de muhafazakâr olarak indekslenir.
 */
const config = require("../config/iddaa-leagues.json");

function statusFor(competitionId) {
  const entry = config.leagues[competitionId];
  return entry ? entry.status : "belirsiz";
}

function isIndexableLeague(competitionId) {
  return statusFor(competitionId) !== "not-iddaa";
}

/** API kotası: iddaa dışı ligler için veri çekilmez. */
function isSyncEnabledLeague(competitionId) {
  return isIndexableLeague(competitionId);
}

module.exports = { config, statusFor, isIndexableLeague, isSyncEnabledLeague };
