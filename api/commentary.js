/**
 * CANLI ANLATIM UÇ NOKTASI.
 *
 * Hafif: tek fikstür, allowlist kontrolü, olaylardan şablon. Yakalanmış
 * yol (`api/[...route].js`) bu dosyayı yüklemez.
 *
 * Olaylar mevcut API-Football istemcisinden gelir (`providerFetch` /
 * `getFixtureEvents`). Anahtar env'den o istemcinin kendi okumasıyla
 * alınır; burada yeni değişken yoktur ve anahtar yazılmaz.
 *
 * `data/fixture-calendar.json` okunmaz. O önbellek 2026-11-06'dan beri
 * tazelenmiyor; bu uç nokta onu yamamaya çalışmaz.
 */

const {
  enforceRateLimit,
  getQuery,
  rejectUnsupportedMethod,
  sendJson,
  setCachePolicy
} = require("./_utils");
const commentary = require("../services/liveCommentary");
const store = require("../services/liveCommentaryStore");

function fixtureIdOf(query) {
  const raw = String((query && (query.fixtureId || query.fixture || query.id)) || "").trim();
  return /^\d{1,12}$/.test(raw) ? raw : "";
}

async function loadProviderFixture(fixtureId) {
  const provider = require("../services/providers/apiFootballProvider");
  const payload = await provider.providerFetch("/fixtures", {
    id: fixtureId,
    timezone: "Europe/Istanbul"
  });
  const item = payload && Array.isArray(payload.response) ? payload.response[0] : null;
  if (!item) return null;
  if (!Array.isArray(item.events)) {
    try {
      const events = await provider.getFixtureEvents({ fixtureId });
      item.events = Array.isArray(events) ? events : [];
    } catch {
      item.events = [];
    }
  }
  return item;
}

async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) return;
  if (enforceRateLimit(req, res)) return;

  const fixtureId = fixtureIdOf(getQuery(req));
  if (!fixtureId) {
    setCachePolicy(res, "commentary-deny");
    return sendJson(res, 200, { enabled: false, reason: "not-allowlisted", lines: [], final: false });
  }

  const saved = store.read(fixtureId);
  if (saved && saved.final === true && saved.enabled === true && Array.isArray(saved.lines)) {
    setCachePolicy(res, "commentary-final");
    return sendJson(res, 200, {
      enabled: true,
      reason: "allowlisted",
      ruleId: saved.ruleId || null,
      fixtureId,
      homeTeam: saved.homeTeam || "",
      awayTeam: saved.awayTeam || "",
      status: saved.status || "FT",
      lines: saved.lines,
      pending: false,
      notice: null,
      final: true
    });
  }

  let item = null;
  try {
    item = await loadProviderFixture(fixtureId);
  } catch {
    item = null;
  }

  const body = commentary.respondToFixture(item);
  if (body.enabled && body.final) {
    store.remember({ ...body, fixtureId: body.fixtureId || fixtureId });
  }

  if (body.final && body.enabled) setCachePolicy(res, "commentary-final");
  else if (body.reason === "not-allowlisted") setCachePolicy(res, "commentary-deny");
  else setCachePolicy(res, "commentary-live");

  return sendJson(res, 200, body);
}

module.exports = handler;
