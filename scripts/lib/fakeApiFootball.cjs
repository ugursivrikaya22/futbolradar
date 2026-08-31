/**
 * SAHTE API-FOOTBALL KATMANI — YALNIZCA TESTLER İÇİN.
 *
 * Üretim kodu bu dosyayı asla yüklemez. Varlık sebebi tek bir boşluk:
 * `sync-turkish-player-profiles.mjs` içindeki derin zenginleştirme dalı
 * `hasConfig()` kapısının arkasında duruyor ve anahtar yalnızca zamanlanmış
 * GitHub Actions koşusunda tanımlı. Yani o kod yolu geliştirici makinesinde,
 * sandbox'ta ve `npm test` içinde HİÇ ÇALIŞMIYORDU — sağlayıcıda olmayan bir
 * metoda yapılan çağrı bu yüzden aylarca fark edilmeden durdu ve haftalık
 * adım her pazartesi 353 ms'de düştü.
 *
 * Sahte katman `globalThis.fetch`i değiştirerek o kapıyı açar: anahtar
 * "tanımlı" görünür, kod gerçek sağlayıcı çağrısına kadar iner, ama tek bir
 * ağ paketi çıkmaz ve tek bir kota isteği harcanmaz.
 *
 * Yanıtlar UYDURULMAZ; `data/super-lig-squads.json` içindeki gerçek kadro
 * anlık görüntüsünden üretilir. Böylece sahte yanıtın alan adları, kimlikleri
 * ve sayfa sayıları üretimdekiyle aynı biçimde olur — biçimi tutmayan bir
 * sahte katman, testi geçirip üretimi düşüren en kötü türden testtir.
 *
 * `node --require scripts/lib/fakeApiFootball.cjs <betik>` biçiminde
 * kullanıldığında FUTBOLRADAR_FAKE_API_FOOTBALL=1 ile kendini kurar.
 */
const fs = require("node:fs");
const path = require("node:path");

/** API-Football `/players` uç noktası sayfa başına 20 kayıt döner. */
const PAGE_SIZE = 20;

function squadSnapshots(root) {
  const file = path.join(root, "data", "super-lig-squads.json");
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Kadro anlık görüntüsündeki oyuncuyu API-Football `/players` biçimine çevirir. */
function playerRow(player, snapshot) {
  return {
    player: {
      id: Number(player.providerId) || player.providerId,
      name: player.name,
      age: player.age ?? null,
      birth: { date: null, place: null, country: null },
      nationality: null,
      height: null,
      weight: null,
      photo: player.photo || null
    },
    statistics: [
      {
        team: { id: Number(snapshot.teamId) || snapshot.teamId, name: snapshot.teamName, logo: snapshot.teamLogo || null },
        league: { id: 203, name: "Süper Lig", season: Number(snapshot.season) || null },
        games: { appearences: 0, minutes: 0, position: player.position || null, rating: null },
        goals: { total: 0, assists: 0 },
        cards: { yellow: 0, red: 0 }
      }
    ]
  };
}

function jsonResponse(payload, options = {}) {
  const headers = new Map(Object.entries(options.headers || {}));
  return {
    ok: options.status ? options.status < 400 : true,
    status: options.status || 200,
    headers: { get: (name) => (headers.has(String(name).toLowerCase()) ? headers.get(String(name).toLowerCase()) : null) },
    json: async () => payload
  };
}

/**
 * @param {object} options
 *   root            proje kökü (varsayılan: process.cwd())
 *   quotaLimit      günlük kota üst sınırı
 *   quotaRemaining  başlangıçta kalan kota; her istekte bir azalır
 *   onRequest       her istek için çağrılan gözlemci
 * @returns {{calls: Array, restore: Function, state: object}}
 */
function install(options = {}) {
  const root = options.root || process.cwd();
  const snapshots = squadSnapshots(root);
  const byTeamId = new Map(snapshots.map((snapshot) => [String(snapshot.teamId), snapshot]));
  const state = {
    quotaLimit: Number.isFinite(options.quotaLimit) ? options.quotaLimit : 7500,
    quotaRemaining: Number.isFinite(options.quotaRemaining) ? options.quotaRemaining : 7500
  };
  const calls = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = new URL(String(input && input.url ? input.url : input));
    const params = Object.fromEntries(url.searchParams.entries());
    calls.push({ path: url.pathname, params });
    state.quotaRemaining = Math.max(0, state.quotaRemaining - 1);
    if (typeof options.onRequest === "function") options.onRequest({ path: url.pathname, params, state });

    const headers = {
      "x-ratelimit-requests-limit": String(state.quotaLimit),
      "x-ratelimit-requests-remaining": String(state.quotaRemaining),
      "x-ratelimit-limit": "300",
      "x-ratelimit-remaining": "299"
    };

    if (url.pathname.endsWith("/players")) {
      const snapshot = byTeamId.get(String(params.team));
      const players = snapshot ? (snapshot.players || []) : [];
      const totalPages = Math.max(1, Math.ceil(players.length / PAGE_SIZE));
      const page = Math.max(1, Number(params.page) || 1);
      const slice = players.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      return jsonResponse({
        get: "players",
        parameters: params,
        errors: [],
        results: slice.length,
        paging: { current: page, total: totalPages },
        response: snapshot ? slice.map((player) => playerRow(player, snapshot)) : []
      }, { headers });
    }

    if (url.pathname.endsWith("/transfers")) {
      const injectTransfers = Array.isArray(options.injectTransfers) ? options.injectTransfers : [];
      const playerId = Number(params.player) || null;
      const matching = injectTransfers.filter((row) => !playerId || (row.player && String(row.player.id) === String(playerId)));
      return jsonResponse({ get: "transfers", parameters: params, errors: [], results: matching.length, paging: { current: 1, total: 1 }, response: matching }, { headers });
    }

    return jsonResponse({ get: url.pathname, parameters: params, errors: [], results: 0, paging: { current: 1, total: 1 }, response: [] }, { headers });
  };

  return {
    calls,
    state,
    restore() {
      globalThis.fetch = original;
    }
  };
}

if (process.env.FUTBOLRADAR_FAKE_API_FOOTBALL === "1") {
  let injectTransfers;
  try {
    injectTransfers = process.env.FUTBOLRADAR_FAKE_INJECT_TRANSFERS
      ? JSON.parse(process.env.FUTBOLRADAR_FAKE_INJECT_TRANSFERS)
      : undefined;
  } catch { injectTransfers = undefined; }
  install({
    quotaRemaining: Number(process.env.FUTBOLRADAR_FAKE_QUOTA_REMAINING) || undefined,
    injectTransfers
  });
}

module.exports = { install, PAGE_SIZE };
