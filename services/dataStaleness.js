/**
 * VERİ BAYATLIĞI — 48 SAATTEN ESKİ SENKRON VERİSİ İÇİN UYARI.
 *
 * Takım sayfaları puan durumu, fikstür ve kadro verisini senkron
 * dosyalarından alır. Senkron durduğunda (sağlayıcı kotası, bozuk iş akışı)
 * sayfalar sessizce eski veriyle yayında kalıyordu: 6 Kasım'da duran veri
 * 26 Kasım'da hâlâ "sıradaki maç" gösteriyordu. Bu modül her kaynağın KENDİ
 * zaman damgasını okur ve eşiği aşanı raporlar.
 *
 * Saf ve ağ çağrısı yapmaz: dosya okuma `readJson` ile enjekte edilir.
 * Zaman damgası okunamayan kaynak "bayat" sayılmaz, "unknown" döner —
 * bilinmeyen yaş, yaş iddiası değildir.
 */
const HOUR_MS = 3600000;
const DEFAULT_MAX_AGE_HOURS = 48;

const maxIso = (values) => values
  .filter((value) => typeof value === "string" && Number.isFinite(Date.parse(value)))
  .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;

/** Senkron zaman damgası taşıyan veri kaynakları. */
const SOURCES = [
  { id: "teams-standings", file: "data/teams.json", label: "Takım puan durumu", at: (d) => maxIso((Array.isArray(d) ? d : []).map((t) => t && t.lastStandingsSyncedAt)) },
  { id: "league-standings", file: "data/league-standings.json", label: "Lig puan durumları", at: (d) => maxIso(Object.values(d || {}).map((l) => l && l.updatedAt)) },
  { id: "super-lig-fixtures", file: "data/super-lig-fixtures.json", label: "Süper Lig fikstürü", at: (d) => maxIso([d && d.lastVerifiedAt]) },
  { id: "fixture-calendar", file: "data/fixture-calendar.json", label: "Maç takvimi", at: (d) => maxIso([d && d.fetchedAt]) },
  { id: "super-lig-squads", file: "data/super-lig-squads.json", label: "Süper Lig kadroları", at: (d) => maxIso((Array.isArray(d) ? d : []).map((t) => t && t.syncedAt)) }
];

/**
 * @param {{readJson:(file:string)=>any, now?:number, maxAgeHours?:number}} options
 * @returns {{maxAgeHours:number, results:Array, stale:Array, ok:boolean}}
 */
function checkDataStaleness({ readJson, now = Date.now(), maxAgeHours = DEFAULT_MAX_AGE_HOURS }) {
  const results = SOURCES.map((source) => {
    let at = null;
    try {
      at = source.at(readJson(source.file));
    } catch {
      at = null;
    }
    if (!at) return { id: source.id, file: source.file, label: source.label, status: "unknown", syncedAt: null, ageHours: null };
    const ageHours = Math.floor((now - Date.parse(at)) / HOUR_MS);
    return { id: source.id, file: source.file, label: source.label, status: ageHours > maxAgeHours ? "stale" : "fresh", syncedAt: at, ageHours };
  });
  const stale = results.filter((result) => result.status === "stale");
  return { maxAgeHours, results, stale, ok: stale.length === 0 };
}

function formatStaleWarning(result, maxAgeHours = DEFAULT_MAX_AGE_HOURS) {
  const days = result.ageHours >= 48 ? ` (~${Math.floor(result.ageHours / 24)} gün)` : "";
  return `[veri-bayatlığı] ${result.label} (${result.file}) ${result.ageHours} saat önce senkronlandı${days}; eşik ${maxAgeHours} saat. Son senkron: ${result.syncedAt}`;
}

module.exports = { DEFAULT_MAX_AGE_HOURS, SOURCES, checkDataStaleness, formatStaleWarning };
