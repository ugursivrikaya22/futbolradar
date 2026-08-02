/**
 * GÜNCELLEYİCİ — var olan bir kaydı yeni bilgiyle birleştirir.
 *
 * Kural: YENİ BİLGİ EKLENİR, ESKİ BİLGİ SİLİNMEZ.
 *
 * Bir transfer önce "ileri görüşme" olarak yayımlanıp sonra kulüp
 * açıkladığında ikinci bir kayıt AÇILMAZ; var olan kayıt `official`'a
 * yükselir, yeni kaynak listeye eklenir ve değişiklik `history` dizisine
 * yazılır. Böylece "bu haber ne zaman neydi" sorusu yanıtlanabilir kalır ve
 * aynı transfer için iki ayrı makale üretilmez.
 *
 * Geri yönde geçiş (resmî → söylenti) statusModel.canTransition tarafından
 * engellenir: bir kaydı sessizce zayıflatmak, okuyucunun daha önce gördüğü
 * doğru bilgiyi geri almak demektir.
 */

const { canTransition, isOfficialTier, resolveStatus } = require("./statusModel.js");
const { scoreTransfer } = require("./confidence.js");
const { candidateSource } = require("./deduplicator.js");

function nowIso() {
  return new Date().toISOString();
}

function uniqueSources(list) {
  const seen = new Set();
  const out = [];
  for (const source of list || []) {
    const key = String((source && source.url) || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}

/**
 * Adaydan YENİ kayıt üretir.
 *
 * @returns {{record: Object, capped: boolean, cappedReason: string}}
 */
function createRecord(candidate, options = {}) {
  const at = options.now || nowIso();
  const sources = uniqueSources(candidate.sources || [candidateSource(candidate)]);
  const tiers = sources.map((source) => source.tier);

  const resolved = resolveStatus(candidate.requestedStatus, tiers);
  const { score, breakdown } = scoreTransfer({ tiers, status: resolved.status });

  const primary = sources[0] || {};
  // RSS tarihleri RFC-822'dir ("Sun, 02 Aug 2026 12:00:00 +0300"). Kayıt
  // boyunca ISO tutulur: aşağı akıştaki `date` alanı ilk on karakteri kesiyor
  // ve normalleştirilmemiş bir tarih orada "Sun, 02 Au" olurdu.
  const announcedAt = toIso(candidate.announcedAt || primary.publishedAt) || at;

  const record = {
    id: candidate.id || options.id || "",
    playerName: candidate.playerName,
    playerId: candidate.playerId || "",
    nationality: candidate.nationality || "unknown",
    age: Number.isFinite(candidate.age) ? candidate.age : null,
    position: candidate.position || "unknown",
    fromTeam: candidate.fromTeam || "",
    toTeam: candidate.toTeam || "",
    type: candidate.type || "unknown",
    fee: candidate.fee || "unknown",
    feeEur: candidate.feeEur === undefined ? null : candidate.feeEur,
    loanFee: candidate.loanFee || "unknown",
    contractUntil: candidate.contractUntil || "unknown",
    loanEndDate: candidate.loanEndDate || "unknown",
    purchaseOption: candidate.purchaseOption || "unknown",
    transferWindow: candidate.transferWindow || "",
    season: candidate.season || "",
    transferStatus: resolved.status,
    confidenceScore: score,
    confidenceBreakdown: breakdown,
    summary: candidate.summary || "",
    announcedAt,
    ingestedAt: at,
    // Gecikme ölçümü: kaynağın yayınından hattın kaydetmesine kadar geçen süre.
    ingestionDelaySeconds: delaySeconds(announcedAt, at),
    sourceUrl: primary.url || candidate.sourceUrl || "",
    sourceName: primary.name || candidate.sourceName || "",
    sourceTier: primary.tier || candidate.sourceTier || "other_media",
    sources,
    lastUpdatedAt: at,
    history: [{
      at,
      status: resolved.status,
      note: resolved.capped ? `oluşturuldu (${resolved.reason})` : "oluşturuldu",
      sourceUrl: primary.url || ""
    }]
  };

  return { record, capped: resolved.capped, cappedReason: resolved.reason };
}

/**
 * Var olan kaydı adayla birleştirir.
 *
 * @returns {{record: Object, changed: boolean, statusChanged: boolean,
 *   blocked: boolean, revival: boolean, notes: string[]}}
 */
function mergeRecord(existing, candidate, options = {}) {
  const at = options.now || nowIso();
  const notes = [];

  const incomingSources = uniqueSources(candidate.sources || [candidateSource(candidate)]);
  const sources = uniqueSources([...(existing.sources || []), ...incomingSources]);
  const tiers = sources.map((source) => source.tier);

  const resolved = resolveStatus(candidate.requestedStatus, incomingSources.map((s) => s.tier));
  if (resolved.capped) notes.push(resolved.reason);

  const transition = canTransition(existing.transferStatus, resolved.status);
  let status = existing.transferStatus;
  let statusChanged = false;

  if (transition.allowed && resolved.status !== existing.transferStatus) {
    status = resolved.status;
    statusChanged = true;
    if (transition.revival) notes.push(transition.reason);
  } else if (!transition.allowed) {
    notes.push(transition.reason);
  }

  const { score, breakdown } = scoreTransfer({ tiers, status });

  const record = { ...existing, sources, transferStatus: status };
  let changed = statusChanged || sources.length !== (existing.sources || []).length;

  // Eksik alanları doldur; DOLU alanı ezme. Resmî kaynak istisnadır:
  // kulübün kendi rakamı basının tahminini düzeltebilir.
  const incomingIsOfficial = incomingSources.some((source) => isOfficialTier(source.tier));
  const fillable = [
    "fromTeam", "toTeam", "type", "fee", "loanFee", "contractUntil",
    "loanEndDate", "purchaseOption", "nationality", "position", "playerId"
  ];

  for (const field of fillable) {
    const incoming = candidate[field];
    if (!incoming || incoming === "unknown") continue;
    const current = record[field];
    const isEmpty = !current || current === "unknown" || current === "";
    if (isEmpty || (incomingIsOfficial && current !== incoming)) {
      if (record[field] !== incoming) {
        record[field] = incoming;
        changed = true;
      }
    }
  }

  if ((record.feeEur === null || record.feeEur === undefined) && candidate.feeEur != null) {
    record.feeEur = candidate.feeEur;
    changed = true;
  }
  if (Number.isFinite(candidate.age) && !Number.isFinite(record.age)) {
    record.age = candidate.age;
    changed = true;
  }

  if (record.confidenceScore !== score) {
    record.confidenceScore = score;
    record.confidenceBreakdown = breakdown;
    changed = true;
  }

  if (changed) {
    record.lastUpdatedAt = at;
    record.history = [
      ...(existing.history || []),
      {
        at,
        status,
        note: statusChanged
          ? `durum ${existing.transferStatus} -> ${status}`
          : "ayrıntı güncellendi",
        sourceUrl: incomingSources[0] ? incomingSources[0].url : ""
      }
    ];
  }

  return {
    record,
    changed,
    statusChanged,
    blocked: !transition.allowed,
    revival: Boolean(transition.revival),
    notes
  };
}

/** Herhangi bir tarih biçimini ISO'ya çevirir; çözemezse boş döner. */
function toIso(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const stamp = Date.parse(raw.length === 10 ? `${raw}T00:00:00Z` : raw);
  return Number.isNaN(stamp) ? "" : new Date(stamp).toISOString();
}

function delaySeconds(from, to) {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 1000));
}

module.exports = {
  createRecord,
  delaySeconds,
  mergeRecord,
  toIso,
  uniqueSources
};
