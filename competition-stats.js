/**
 * Competition stats page — client filters (team + round).
 *
 * Reads the embedded `#competition-stats-data` payload (the same data the
 * page was server-rendered from) and re-renders the four sections with
 * competition-stats-core.js. The selection lives in the URL (?takim=&tur= /
 * ?team=&round=) via history.replaceState, so a filtered view can be shared.
 * No network request is made.
 */
(function () {
  "use strict";
  var core = window.FutbolRadarCompetitionStats;
  var dataNode = document.getElementById("competition-stats-data");
  var form = document.querySelector("[data-cs-filters]");
  if (!core || !dataNode || !form) return;

  var payload;
  try { payload = JSON.parse(dataNode.textContent || "{}"); } catch (error) { return; }

  var teamSelect = form.querySelector("[data-cs-team]");
  var roundSelect = form.querySelector("[data-cs-round]");
  var resetButton = form.querySelector("[data-cs-reset]");
  var applyButton = form.querySelector("[data-cs-apply]");
  var status = form.querySelector("[data-cs-status]");
  var slots = {};
  Array.prototype.forEach.call(document.querySelectorAll("[data-cs-slot]"), function (node) {
    slots[node.getAttribute("data-cs-slot")] = node;
  });

  // With JS the selects apply instantly; the submit button is only the no-JS path.
  if (applyButton) applyButton.hidden = true;

  function currentState() {
    var search = [];
    if (teamSelect && teamSelect.value) search.push(payload.params.team + "=" + encodeURIComponent(teamSelect.value));
    if (roundSelect && roundSelect.value) search.push(payload.params.round + "=" + encodeURIComponent(roundSelect.value));
    return core.parseState("?" + search.join("&"), payload);
  }

  function render(state, options) {
    if (slots.scorers) slots.scorers.innerHTML = core.leadersTableHtml(payload, "goals", state);
    if (slots.assists) slots.assists.innerHTML = core.leadersTableHtml(payload, "assists", state);
    if (slots.form) slots.form.innerHTML = core.formTableHtml(payload, state);
    if (slots.rounds) slots.rounds.innerHTML = core.roundStatsHtml(payload, state);
    if (teamSelect) teamSelect.innerHTML = core.teamOptionsHtml(payload, state);
    if (roundSelect) roundSelect.innerHTML = core.roundOptionsHtml(payload, state);
    var filtered = Boolean(state.teamId || state.roundKey);
    if (resetButton) resetButton.hidden = !filtered;
    if (status) {
      var team = state.teamId ? core.teamById(payload, state.teamId) : null;
      var label = [team ? team.name : "", roundSelect && roundSelect.value ? roundSelect.options[roundSelect.selectedIndex].text : ""].filter(Boolean).join(" · ");
      status.textContent = label;
    }
    if (!options || options.updateUrl !== false) {
      var search = core.buildSearch(state, payload);
      try { window.history.replaceState(null, "", window.location.pathname + search + window.location.hash); } catch (error) { /* file:// or sandbox */ }
    }
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    render(currentState());
  });
  if (teamSelect) teamSelect.addEventListener("change", function () { render(currentState()); });
  if (roundSelect) roundSelect.addEventListener("change", function () { render(currentState()); });
  if (resetButton) resetButton.addEventListener("click", function () {
    render({ teamId: null, roundKey: "", matchday: null });
  });

  var initial = core.parseState(window.location.search, payload);
  if (initial.teamId || initial.roundKey) render(initial, { updateUrl: false });
})();
