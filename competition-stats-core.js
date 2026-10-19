/**
 * COMPETITION STATS CORE — shared by the static generator (Node) and the
 * page's client filters (browser). One implementation of the numbers and
 * the markup, so the server-rendered default view and the client-filtered
 * view can never disagree.
 *
 * Rules:
 *   • Only provider data. Nothing is estimated or filled in: a missing value
 *     renders as "—", a missing dataset as an explicit "Veri bekleniyor" /
 *     "Awaiting data" state.
 *   • Top scorer / assist lists are SEASON totals from API-Football
 *     (/players/topscorers, /players/topassists, top 20). The round filter
 *     therefore never claims to filter them; only the team filter applies.
 *   • Form and per-round numbers are computed from finished fixtures
 *     (status FINISHED or AWARDED with both scores present).
 *
 * Browser: `window.FutbolRadarCompetitionStats`; Node: `module.exports`.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && typeof root === "object") root.FutbolRadarCompetitionStats = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var FINISHED = { FINISHED: true, AWARDED: true };

  var TEXT = {
    tr: {
      allTeams: "Tüm takımlar",
      allRounds: "Tüm turlar (eleme hariç)",
      matchday: "{n}. maç günü",
      rank: "Sıra", player: "Oyuncu", team: "Takım", goals: "Gol", assists: "Asist", apps: "Maç",
      played: "O", won: "G", drawn: "B", lost: "M", gf: "A", ga: "Y", gd: "Av.", points: "P", last5: "Son 5",
      formCode: { W: "G", D: "B", L: "M" },
      formName: { W: "Galibiyet", D: "Beraberlik", L: "Mağlubiyet" },
      awaiting: "Veri bekleniyor",
      updating: "Güncelleniyor",
      leadersEmpty: "{league} {metric} listesi sağlayıcıdan geldiğinde burada görünür.",
      leadersTeamEmpty: "{team} oyuncularından bu listede (sağlayıcının ilk 20 sıralaması) kimse yok.",
      fixturesEmpty: "Tur ve form istatistikleri, sağlayıcıdan sezon fikstürü alındığında hesaplanır.",
      noFinished: "Bu seçimde henüz oynanmış maç yok.",
      upcomingCount: "{n} maç planlandı.",
      summaryMatches: "Oynanan maç", summaryGoals: "Gol", summaryAvg: "Maç başı gol",
      summaryHome: "Ev sahibi galibiyeti", summaryDraw: "Beraberlik", summaryAway: "Deplasman galibiyeti",
      summaryBtts: "Karşılıklı gol", summaryBiggest: "En farklı skor",
      resultsTitle: "Maçlar", latestResults: "Son sonuçlar",
      scheduled: "Planlandı", live: "Oynanıyor", postponed: "Ertelendi", cancelled: "İptal",
      seasonTotalsNote: "Gol ve asist listeleri sezon toplamıdır; tur filtresi yalnızca form ve tur istatistiklerine uygulanır.",
      showing: "{n} oyuncu",
      formScopeNote: "Form tablosu seçili turlardaki oynanmış maçlardan hesaplanır."
    },
    en: {
      allTeams: "All teams",
      allRounds: "All rounds (excl. qualifying)",
      matchday: "Matchday {n}",
      rank: "Rank", player: "Player", team: "Team", goals: "Goals", assists: "Assists", apps: "Apps",
      played: "P", won: "W", drawn: "D", lost: "L", gf: "GF", ga: "GA", gd: "GD", points: "Pts", last5: "Last 5",
      formCode: { W: "W", D: "D", L: "L" },
      formName: { W: "Win", D: "Draw", L: "Loss" },
      awaiting: "Awaiting data",
      updating: "Updating",
      leadersEmpty: "The {league} {metric} list appears here once the provider publishes it.",
      leadersTeamEmpty: "No {team} player is in this list (the provider's top 20).",
      fixturesEmpty: "Round and form stats are calculated once the season fixture list arrives from the provider.",
      noFinished: "No matches have been played in this selection yet.",
      upcomingCount: "{n} matches scheduled.",
      summaryMatches: "Matches played", summaryGoals: "Goals", summaryAvg: "Goals per match",
      summaryHome: "Home wins", summaryDraw: "Draws", summaryAway: "Away wins",
      summaryBtts: "Both teams scored", summaryBiggest: "Biggest margin",
      resultsTitle: "Matches", latestResults: "Latest results",
      scheduled: "Scheduled", live: "In play", postponed: "Postponed", cancelled: "Cancelled",
      seasonTotalsNote: "Goal and assist lists are season totals; the round filter applies to form and round stats only.",
      showing: "{n} players",
      formScopeNote: "The form table is calculated from played matches in the selected rounds."
    }
  };

  function text(locale, key, vars) {
    var dict = TEXT[locale === "en" ? "en" : "tr"];
    var value = dict[key];
    if (typeof value !== "string") return value;
    return value.replace(/\{(\w+)\}/g, function (_, name) {
      return vars && vars[name] !== undefined && vars[name] !== null ? String(vars[name]) : "";
    });
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function cell(value) {
    return value === undefined || value === null || value === "" ? "—" : escapeHtml(value);
  }

  /** ASCII URL slug ("Bodø/Glimt" → "bodo-glimt", "Beşiktaş" → "besiktas"). */
  function slugify(value) {
    var map = { "ı": "i", "İ": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g", "ç": "c", "Ç": "c", "ö": "o", "Ö": "o", "ü": "u", "Ü": "u", "ø": "o", "Ø": "o", "æ": "ae", "å": "a", "ß": "ss", "đ": "d", "ł": "l" };
    var out = String(value || "").replace(/[ıİşŞğĞçÇöÖüÜøØæåßđł]/g, function (ch) { return map[ch] || ch; });
    if (out.normalize) out = out.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return out.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function isFinished(fixture) {
    return Boolean(fixture && FINISHED[fixture.st] && typeof fixture.hs === "number" && typeof fixture.as === "number");
  }

  function roundByKey(payload, key) {
    var rounds = (payload && payload.rounds) || [];
    for (var i = 0; i < rounds.length; i += 1) if (rounds[i].key === key) return rounds[i];
    return null;
  }

  function roundParamKey(round, locale) {
    return locale === "en" ? (round.keyEn || round.key) : round.key;
  }

  /**
   * URL state. TR: ?takim=<team-slug>&tur=<round>[-<matchday>]
   *            EN: ?team=<team-slug>&round=<round>[-<matchday>]
   * Unknown values are ignored (default view), never guessed.
   */
  function parseState(search, payload) {
    var locale = payload.locale === "en" ? "en" : "tr";
    var params = payload.params || (locale === "en" ? { team: "team", round: "round" } : { team: "takim", round: "tur" });
    var query = {};
    String(search || "").replace(/^\?/, "").split("&").forEach(function (pair) {
      if (!pair) return;
      var parts = pair.split("=");
      try { query[decodeURIComponent(parts[0])] = decodeURIComponent((parts[1] || "").replace(/\+/g, " ")); } catch (error) { /* malformed → ignored */ }
    });
    var state = { teamId: null, roundKey: "", matchday: null };
    var teamSlug = query[params.team];
    if (teamSlug) {
      (payload.teams || []).forEach(function (team) { if (team.slug === teamSlug) state.teamId = team.id; });
    }
    var roundValue = query[params.round];
    if (roundValue) {
      (payload.rounds || []).forEach(function (round) {
        var key = roundParamKey(round, locale);
        if (roundValue === key) { state.roundKey = round.key; state.matchday = null; }
        else if (round.matchdays && roundValue.indexOf(key + "-") === 0) {
          var md = Number(roundValue.slice(key.length + 1));
          if (md >= 1 && md <= round.matchdays) { state.roundKey = round.key; state.matchday = md; }
        }
      });
    }
    return state;
  }

  function buildSearch(state, payload) {
    var locale = payload.locale === "en" ? "en" : "tr";
    var params = payload.params || (locale === "en" ? { team: "team", round: "round" } : { team: "takim", round: "tur" });
    var parts = [];
    if (state.teamId) {
      var team = teamById(payload, state.teamId);
      if (team) parts.push(params.team + "=" + encodeURIComponent(team.slug));
    }
    if (state.roundKey) {
      var round = roundByKey(payload, state.roundKey);
      if (round) parts.push(params.round + "=" + encodeURIComponent(roundParamKey(round, locale) + (state.matchday ? "-" + state.matchday : "")));
    }
    return parts.length ? "?" + parts.join("&") : "";
  }

  function teamById(payload, id) {
    var teams = (payload && payload.teams) || [];
    for (var i = 0; i < teams.length; i += 1) if (String(teams[i].id) === String(id)) return teams[i];
    return null;
  }

  function selectFixtures(payload, state) {
    var fixtures = (payload && payload.fixtures) || [];
    var roundKey = state && state.roundKey;
    var matchday = state && state.matchday;
    var teamId = state && state.teamId ? String(state.teamId) : null;
    var excluded = {};
    (payload.rounds || []).forEach(function (round) { if (round.inDefaultScope === false) excluded[round.key] = true; });
    return fixtures.filter(function (fixture) {
      if (roundKey) {
        if (fixture.r !== roundKey) return false;
        if (matchday && fixture.md !== matchday) return false;
      } else if (excluded[fixture.r]) {
        return false;
      }
      if (teamId && String(fixture.h) !== teamId && String(fixture.a) !== teamId) return false;
      return true;
    });
  }

  function byKickoff(left, right) {
    return String(left.k || "").localeCompare(String(right.k || "")) || String(left.id).localeCompare(String(right.id));
  }

  function resultFor(fixture, teamId) {
    var home = String(fixture.h) === String(teamId);
    var forGoals = home ? fixture.hs : fixture.as;
    var againstGoals = home ? fixture.as : fixture.hs;
    return { code: forGoals > againstGoals ? "W" : forGoals < againstGoals ? "L" : "D", gf: forGoals, ga: againstGoals };
  }

  /**
   * Form table over the given fixtures: one row per team with played/W/D/L,
   * goals and the last five results (oldest → newest). Sorted by points over
   * the last five, then goal difference, then name — it is a form table, not
   * the official standings (those live on the standings page).
   */
  function formTable(payload, fixtures, options) {
    var limit = (options && options.last) || 5;
    var onlyTeam = options && options.teamId ? String(options.teamId) : null;
    var finished = fixtures.filter(isFinished).slice().sort(byKickoff);
    var rows = {};
    (payload.teams || []).forEach(function (team) {
      rows[String(team.id)] = { team: team, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, results: [] };
    });
    finished.forEach(function (fixture) {
      [fixture.h, fixture.a].forEach(function (teamId) {
        var row = rows[String(teamId)];
        if (!row) return;
        var result = resultFor(fixture, teamId);
        row.played += 1;
        row.gf += result.gf;
        row.ga += result.ga;
        if (result.code === "W") row.won += 1; else if (result.code === "D") row.drawn += 1; else row.lost += 1;
        row.results.push({ code: result.code, fixtureId: fixture.id });
      });
    });
    var list = Object.keys(rows).map(function (id) {
      var row = rows[id];
      row.last = row.results.slice(-limit);
      row.formPoints = row.last.reduce(function (sum, item) { return sum + (item.code === "W" ? 3 : item.code === "D" ? 1 : 0); }, 0);
      row.points = row.won * 3 + row.drawn;
      row.gd = row.gf - row.ga;
      return row;
    }).filter(function (row) { return row.played > 0 && (!onlyTeam || String(row.team.id) === onlyTeam); });
    list.sort(function (left, right) {
      return right.formPoints - left.formPoints || right.gd - left.gd || right.gf - left.gf || String(left.team.name).localeCompare(String(right.team.name));
    });
    return list;
  }

  function roundSummary(fixtures) {
    var finished = fixtures.filter(isFinished);
    var summary = { total: fixtures.length, finished: finished.length, goals: 0, homeWins: 0, draws: 0, awayWins: 0, btts: 0, biggest: null };
    finished.forEach(function (fixture) {
      summary.goals += fixture.hs + fixture.as;
      if (fixture.hs > fixture.as) summary.homeWins += 1; else if (fixture.hs < fixture.as) summary.awayWins += 1; else summary.draws += 1;
      if (fixture.hs > 0 && fixture.as > 0) summary.btts += 1;
      var margin = Math.abs(fixture.hs - fixture.as);
      if (margin > 0 && (!summary.biggest || margin > summary.biggestMargin || (margin === summary.biggestMargin && fixture.hs + fixture.as > summary.biggest.hs + summary.biggest.as))) {
        summary.biggest = fixture;
        summary.biggestMargin = margin;
      }
    });
    summary.avgGoals = finished.length ? Math.round((summary.goals / finished.length) * 100) / 100 : null;
    return summary;
  }

  // ── Markup ────────────────────────────────────────────────────────────────

  function emptyState(title, note, kind) {
    return '<div class="data-empty cs-empty" data-card="empty-state" data-empty-kind="' + escapeHtml(kind || "awaiting") + '"><strong>' + escapeHtml(title) + "</strong><span>" + escapeHtml(note) + "</span></div>";
  }

  function teamLogoHtml(logo) {
    return logo ? '<img class="cs-logo" src="' + escapeHtml(logo) + '" alt="" width="20" height="20" loading="lazy" decoding="async" />' : '<span class="cs-logo cs-logo-empty" aria-hidden="true"></span>';
  }

  function leadersTableHtml(payload, metric, state) {
    var locale = payload.locale;
    var list = metric === "assists" ? payload.assists : payload.scorers;
    var metricLabel = text(locale, metric === "assists" ? "assists" : "goals");
    if (!list || !list.length) {
      return emptyState(text(locale, "awaiting"), text(locale, "leadersEmpty", { league: payload.league.name, metric: metricLabel.toLocaleLowerCase(locale === "en" ? "en" : "tr-TR") }));
    }
    var teamId = state && state.teamId ? String(state.teamId) : null;
    var rows = teamId ? list.filter(function (row) { return String(row.teamId) === teamId; }) : list;
    if (!rows.length) {
      var team = teamById(payload, teamId);
      return emptyState(metricLabel, text(locale, "leadersTeamEmpty", { team: team ? team.name : "" }), "filtered");
    }
    var body = rows.map(function (row) {
      var name = row.href ? '<a href="' + escapeHtml(row.href) + '">' + escapeHtml(row.name) + "</a>" : "<span>" + escapeHtml(row.name) + "</span>";
      return '<tr><td class="cs-col-rank">' + cell(row.rank) + '</td><th scope="row" class="cs-col-player"><span class="cs-player-name">' + name + '</span><span class="cs-team cs-player-team">' + teamLogoHtml(row.teamLogo) + "<span>" + escapeHtml(row.team || "") + '</span></span></th><td class="cs-col-num"><strong>' + cell(row[metric]) + '</strong></td><td class="cs-col-num">' + (row.apps ? escapeHtml(row.apps) : "—") + "</td></tr>";
    }).join("");
    return '<div class="evergreen-table-wrap"><table class="evergreen-table cs-table cs-leaders-table"><thead><tr><th scope="col" class="cs-col-rank">' + escapeHtml(text(locale, "rank")) + '</th><th scope="col" class="cs-col-player">' + escapeHtml(text(locale, "player")) + " · " + escapeHtml(text(locale, "team")) + '</th><th scope="col" class="cs-col-num">' + escapeHtml(metricLabel) + '</th><th scope="col" class="cs-col-num">' + escapeHtml(text(locale, "apps")) + "</th></tr></thead><tbody>" + body + "</tbody></table></div>";
  }

  function formChips(locale, results) {
    return '<span class="cs-form">' + results.map(function (item) {
      return '<span class="cs-form-chip cs-form-' + item.code.toLowerCase() + '" title="' + escapeHtml(text(locale, "formName")[item.code]) + '">' + escapeHtml(text(locale, "formCode")[item.code]) + "</span>";
    }).join("") + "</span>";
  }

  function formTableHtml(payload, state) {
    var locale = payload.locale;
    if (!payload.fixtures || !payload.fixtures.length) {
      return emptyState(text(locale, "updating"), text(locale, "fixturesEmpty"));
    }
    var scopeState = { roundKey: state.roundKey, matchday: state.matchday, teamId: null };
    var rows = formTable(payload, selectFixtures(payload, scopeState), { teamId: state.teamId, last: 5 });
    if (!rows.length) return emptyState(text(locale, "awaiting"), text(locale, "noFinished"), "filtered");
    var body = rows.map(function (row) {
      return '<tr><th scope="row" class="cs-col-team"><span class="cs-team">' + teamLogoHtml(row.team.logo) + "<span>" + escapeHtml(row.team.name) + '</span></span></th><td class="cs-col-num">' + row.played + '</td><td class="cs-col-num cs-col-wide">' + row.won + '</td><td class="cs-col-num cs-col-wide">' + row.drawn + '</td><td class="cs-col-num cs-col-wide">' + row.lost + '</td><td class="cs-col-num cs-col-wide">' + row.gf + '</td><td class="cs-col-num cs-col-wide">' + row.ga + '</td><td class="cs-col-num">' + (row.gd > 0 ? "+" : "") + row.gd + '</td><td class="cs-col-form">' + formChips(locale, row.last) + "</td></tr>";
    }).join("");
    var colClass = { team: "cs-col-team", played: "cs-col-num", won: "cs-col-num cs-col-wide", drawn: "cs-col-num cs-col-wide", lost: "cs-col-num cs-col-wide", gf: "cs-col-num cs-col-wide", ga: "cs-col-num cs-col-wide", gd: "cs-col-num", last5: "cs-col-form" };
    var head = ["team", "played", "won", "drawn", "lost", "gf", "ga", "gd", "last5"].map(function (key) {
      return '<th scope="col" class="' + colClass[key] + '">' + escapeHtml(text(locale, key)) + "</th>";
    }).join("");
    return '<div class="evergreen-table-wrap"><table class="evergreen-table cs-table cs-form-table"><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div>";
  }

  function formatKickoff(iso, locale) {
    if (!iso) return "—";
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "—";
    try {
      return date.toLocaleString(locale === "en" ? "en-GB" : "tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
    } catch (error) {
      return String(iso).slice(0, 16).replace("T", " ");
    }
  }

  function statusLabel(fixture, locale) {
    var st = fixture.st;
    if (st === "LIVE" || st === "HALFTIME") return text(locale, "live");
    if (st === "POSTPONED") return text(locale, "postponed");
    if (st === "CANCELLED" || st === "ABANDONED") return text(locale, "cancelled");
    return formatKickoff(fixture.k, locale);
  }

  function roundLabel(payload, fixture) {
    var round = roundByKey(payload, fixture.r);
    if (!round) return fixture.rl || "";
    return round.name + (fixture.md ? " · " + text(payload.locale, "matchday", { n: fixture.md }) : "");
  }

  function fixtureRowHtml(payload, fixture) {
    var locale = payload.locale;
    var home = teamById(payload, fixture.h) || { name: fixture.hn || "" };
    var away = teamById(payload, fixture.a) || { name: fixture.an || "" };
    var middle = isFinished(fixture)
      ? '<strong class="cs-score">' + fixture.hs + "–" + fixture.as + "</strong>"
      : '<span class="cs-kickoff">' + escapeHtml(statusLabel(fixture, locale)) + "</span>";
    return '<li class="cs-fixture"><span class="cs-fixture-round">' + escapeHtml(roundLabel(payload, fixture)) + '</span><span class="cs-fixture-teams"><span class="cs-home">' + escapeHtml(home.name) + "</span>" + middle + '<span class="cs-away">' + escapeHtml(away.name) + "</span></span></li>";
  }

  function roundStatsHtml(payload, state) {
    var locale = payload.locale;
    if (!payload.fixtures || !payload.fixtures.length) {
      return emptyState(text(locale, "updating"), text(locale, "fixturesEmpty"));
    }
    var fixtures = selectFixtures(payload, state).slice().sort(byKickoff);
    var summary = roundSummary(fixtures);
    var parts = [];
    if (!summary.finished) {
      parts.push(emptyState(text(locale, "awaiting"), text(locale, "noFinished") + (summary.total ? " " + text(locale, "upcomingCount", { n: summary.total }) : ""), "filtered"));
    } else {
      var avg = summary.avgGoals === null ? "—" : String(summary.avgGoals).replace(".", locale === "en" ? "." : ",");
      var biggest = summary.biggest
        ? escapeHtml((teamById(payload, summary.biggest.h) || {}).name || "") + " " + summary.biggest.hs + "–" + summary.biggest.as + " " + escapeHtml((teamById(payload, summary.biggest.a) || {}).name || "")
        : "—";
      var metrics = [
        ["summaryMatches", summary.finished + " / " + summary.total],
        ["summaryGoals", String(summary.goals)],
        ["summaryAvg", avg],
        ["summaryHome", String(summary.homeWins)],
        ["summaryDraw", String(summary.draws)],
        ["summaryAway", String(summary.awayWins)],
        ["summaryBtts", String(summary.btts)]
      ];
      parts.push('<dl class="cs-summary">' + metrics.map(function (metric) {
        return '<div class="cs-summary-item"><dt>' + escapeHtml(text(locale, metric[0])) + "</dt><dd>" + escapeHtml(metric[1]) + "</dd></div>";
      }).join("") + '<div class="cs-summary-item cs-summary-wide"><dt>' + escapeHtml(text(locale, "summaryBiggest")) + "</dt><dd>" + biggest + "</dd></div></dl>");
    }
    // Default (no round, no team) view lists only the latest results; a round
    // or a team selection lists every match in that selection.
    var narrowed = Boolean(state.roundKey || state.teamId);
    var listed = narrowed ? fixtures : fixtures.filter(isFinished).slice(-10).reverse();
    if (listed.length) {
      parts.push('<h3 class="cs-subhead">' + escapeHtml(text(locale, narrowed ? "resultsTitle" : "latestResults")) + '</h3><ul class="cs-fixtures">' + listed.map(function (fixture) { return fixtureRowHtml(payload, fixture); }).join("") + "</ul>");
    }
    return parts.join("");
  }

  function teamOptionsHtml(payload, state) {
    var locale = payload.locale;
    var teams = (payload.teams || []).slice().sort(function (left, right) { return String(left.name).localeCompare(String(right.name), locale === "en" ? "en" : "tr"); });
    return '<option value="">' + escapeHtml(text(locale, "allTeams")) + "</option>" + teams.map(function (team) {
      return '<option value="' + escapeHtml(team.slug) + '"' + (state && String(state.teamId) === String(team.id) ? " selected" : "") + ">" + escapeHtml(team.name) + "</option>";
    }).join("");
  }

  function roundOptionsHtml(payload, state) {
    var locale = payload.locale;
    var present = {};
    (payload.fixtures || []).forEach(function (fixture) { present[fixture.r + "|" + (fixture.md || "")] = true; present[fixture.r] = true; });
    var options = ['<option value="">' + escapeHtml(text(locale, "allRounds")) + "</option>"];
    (payload.rounds || []).forEach(function (round) {
      var key = roundParamKey(round, locale);
      var selected = state && state.roundKey === round.key && !state.matchday;
      options.push('<option value="' + escapeHtml(key) + '"' + (selected ? " selected" : "") + (present[round.key] ? "" : ' data-empty-round="true"') + ">" + escapeHtml(round.name) + "</option>");
      for (var md = 1; round.matchdays && md <= round.matchdays; md += 1) {
        var mdSelected = state && state.roundKey === round.key && state.matchday === md;
        options.push('<option value="' + escapeHtml(key + "-" + md) + '"' + (mdSelected ? " selected" : "") + (present[round.key + "|" + md] ? "" : ' data-empty-round="true"') + ">" + escapeHtml(round.name + " · " + text(locale, "matchday", { n: md })) + "</option>");
      }
    });
    return options.join("");
  }

  return {
    TEXT: TEXT,
    text: text,
    escapeHtml: escapeHtml,
    slugify: slugify,
    isFinished: isFinished,
    parseState: parseState,
    buildSearch: buildSearch,
    teamById: teamById,
    selectFixtures: selectFixtures,
    formTable: formTable,
    roundSummary: roundSummary,
    leadersTableHtml: leadersTableHtml,
    formTableHtml: formTableHtml,
    roundStatsHtml: roundStatsHtml,
    teamOptionsHtml: teamOptionsHtml,
    roundOptionsHtml: roundOptionsHtml
  };
});
