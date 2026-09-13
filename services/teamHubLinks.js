const { slug } = require("./superLigTeams.js");

const TEAM_HUBS = new Set(["galatasaray", "fenerbahce", "besiktas", "trabzonspor"]);

function teamHubFile(teamName) {
  const teamSlug = slug(teamName);
  return TEAM_HUBS.has(teamSlug) ? `${teamSlug}-maclari.html` : null;
}

function teamHubHref(teamName, base = "./") {
  const file = teamHubFile(teamName);
  return file ? `${base}${file}` : null;
}

module.exports = { TEAM_HUBS, teamHubFile, teamHubHref };
