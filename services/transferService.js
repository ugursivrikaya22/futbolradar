/**
 * DOĞRULANMIŞ TRANSFER HATTI — tek yetkili kural.
 *
 * Kök sorun: data/transfers.json 22 doğrulanmış hareket taşıyordu ama hiçbir
 * takım sayfasına bağlı değildi. Takım kartı `team.recentTransfers` alanını
 * okuyor, o alan hiçbir yerde doldurulmuyordu; sonuç, doğrulanmış veri
 * dururken on sekiz takımın transfer bölümünün boş kalmasıydı.
 *
 * YAYIN KURALI — söylenti yayımlanmaz:
 *
 *   1. status "confirmed" olmalı. "rumour", "talks", "medical" gibi ara
 *      durumlar hattın dışında kalır.
 *   2. İzlenebilir bir kaynak olmalı: sourceUrl (http/https) VE sourceName.
 *      Kaynağı gösterilemeyen bir hareket yayımlanmaz.
 *   3. Kimlik alanları tam olmalı: oyuncu adı, iki taraf, tür, tarih.
 *   4. Tarih okunabilir olmalı.
 *
 * Bu kuralların herhangi biri tutmazsa kayıt SESSİZCE atlanmaz: gerekçesiyle
 * iç günlüğe yazılır.
 *
 * TEKİLLEŞTİRME: aynı hareket birden çok kaynaktan gelebilir (kulüp
 * açıklaması + federasyon kaydı). Kimlik, oyuncu + iki taraf + sezon
 * üzerinden kurulur; aynı kimlikte birden çok kayıt varsa en son
 * doğrulanmış olan kazanır.
 */

const fs = require("node:fs");
const path = require("node:path");
const { normalizeText } = require("./matchRadarService");

/** Yalnızca bu durum yayımlanır. Geri kalanı söylentidir. */
const PUBLISHABLE_STATUS = "confirmed";

/** Kaynağı olmayan hareket yayımlanmaz. */
const REQUIRED_FIELDS = ["playerName", "fromTeam", "toTeam", "type", "date", "sourceName", "sourceUrl"];

function readTransfers() {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "data", "transfers.json"), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : (parsed.transfers || []);
  } catch {
    return [];
  }
}

function isTraceableUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Tek bir hareketin yayımlanabilirliği.
 * @returns {{publishable: boolean, reason: string}}
 */
function evaluateTransfer(transfer) {
  if (!transfer || typeof transfer !== "object") {
    return { publishable: false, reason: "kayıt yok" };
  }

  const status = String(transfer.status || "").toLowerCase();
  if (status !== PUBLISHABLE_STATUS) {
    return { publishable: false, reason: `durum onaylı değil: ${status || "belirtilmemiş"}` };
  }

  const missing = REQUIRED_FIELDS.filter((field) => !String(transfer[field] ?? "").trim());
  if (missing.length) {
    return { publishable: false, reason: `zorunlu alan eksik: ${missing.join(", ")}` };
  }

  if (!isTraceableUrl(transfer.sourceUrl)) {
    return { publishable: false, reason: "kaynak bağlantısı izlenebilir değil" };
  }

  if (Number.isNaN(Date.parse(`${transfer.date}T00:00:00Z`)) && Number.isNaN(Date.parse(transfer.date))) {
    return { publishable: false, reason: "tarih okunamıyor" };
  }

  return { publishable: true, reason: "" };
}

/** Aynı hareketi iki kez yayımlamamak için kimlik. */
function transferIdentity(transfer) {
  return [
    normalizeText(transfer.playerName),
    normalizeText(transfer.fromTeam),
    normalizeText(transfer.toTeam),
    String(transfer.season || "").trim()
  ].join("|");
}

function verifiedAtTime(transfer) {
  const stamp = Date.parse(transfer.lastVerifiedAt || transfer.date);
  return Number.isNaN(stamp) ? 0 : stamp;
}

/**
 * Yayımlanabilir hareketler, tekilleştirilmiş ve tarihe göre yeniden eskiye.
 * @returns {{transfers: Array, excluded: Array, duplicates: Array}}
 */
function publishableTransfers(options = {}) {
  const source = Array.isArray(options.transfers) ? options.transfers : readTransfers();
  const excluded = [];
  const duplicates = [];
  const byIdentity = new Map();

  for (const transfer of source) {
    const verdict = evaluateTransfer(transfer);
    if (!verdict.publishable) {
      excluded.push({ id: (transfer && transfer.id) || "?", reason: verdict.reason });
      continue;
    }

    const identity = transferIdentity(transfer);
    const existing = byIdentity.get(identity);

    if (!existing) {
      byIdentity.set(identity, transfer);
      continue;
    }

    // Aynı hareket iki kaynaktan gelmiş: en son doğrulanan kazanır.
    // Kayıt, kararın SONUCUNU yansıtmalı — hangi kaydın düştüğü ve hangisinin
    // kaldığı karşılaştırmadan sonra belli olur.
    const incomingWins = verifiedAtTime(transfer) > verifiedAtTime(existing);
    const winner = incomingWins ? transfer : existing;
    const loser = incomingWins ? existing : transfer;

    duplicates.push({ id: loser.id || "?", keptId: winner.id || "?", identity });
    byIdentity.set(identity, winner);
  }

  const transfers = [...byIdentity.values()].sort((left, right) =>
    String(right.date || "").localeCompare(String(left.date || "")));

  return { transfers, excluded, duplicates };
}

/**
 * Bir takımın gelen ve giden hareketleri.
 *
 * Takım adı iki kaynakta farklı yazılabildiği için ("Çaykur Rizespor" /
 * "Rizespor") eşleştirme Türkçe katlamalı ve içeren biçimde yapılır.
 */
function transfersForTeam(teamName, options = {}) {
  const target = normalizeText(teamName);
  if (!target) return { incoming: [], outgoing: [] };

  const { transfers } = options.prepared || publishableTransfers(options);

  const matches = (value) => {
    const name = normalizeText(value);
    if (!name) return false;
    return name === target || name.includes(target) || target.includes(name);
  };

  return {
    incoming: transfers.filter((transfer) => matches(transfer.toTeam)),
    outgoing: transfers.filter((transfer) => matches(transfer.fromTeam))
  };
}

/**
 * Hareket Süper Lig ile ilgili mi?
 *
 * En az bir taraf Süper Lig kulübü olmalı. Giden transferlerde karşı taraf
 * yabancı bir kulüp olabilir (Trabzonspor → Fiorentina) ve bu hareket yine
 * Süper Lig haberidir; iki tarafı da lig dışında olan bir hareket değildir.
 *
 * Karşılaştırma TFF fikstüründen türeyen on sekiz takım adına göre yapılır —
 * elle tutulan ayrı bir liste zamanla ligden farklılaşırdı.
 */
function involvesSuperLigTeam(transfer, teamNames) {
  const names = teamNames || superLigNames();
  const sides = [transfer && transfer.fromTeam, transfer && transfer.toTeam];

  return sides.some((side) => {
    const value = normalizeText(side);
    if (!value) return false;
    return names.some((name) => name === value || name.includes(value) || value.includes(name));
  });
}

let cachedSuperLigNames = null;

function superLigNames() {
  if (cachedSuperLigNames) return cachedSuperLigNames;
  try {
    const { fixtureTeamNames } = require("./superLigTeams.js");
    cachedSuperLigNames = fixtureTeamNames().map((name) => normalizeText(name)).filter(Boolean);
  } catch {
    cachedSuperLigNames = [];
  }
  return cachedSuperLigNames;
}

/** İç günlük: yayımlanmayan hareketler gerekçesiyle. */
function logExcludedTransfers(scope, excluded) {
  for (const item of excluded || []) {
    console.warn(`[futbolradar:transfer-excluded] scope=${scope} id=${item.id} reason="${item.reason}"`);
  }
}

/** İç günlük: tekilleştirmede düşen kayıtlar. */
function logDuplicateTransfers(scope, duplicates) {
  for (const item of duplicates || []) {
    console.warn(`[futbolradar:transfer-duplicate] scope=${scope} dropped=${item.id} kept=${item.keptId}`);
  }
}

module.exports = {
  PUBLISHABLE_STATUS,
  REQUIRED_FIELDS,
  evaluateTransfer,
  involvesSuperLigTeam,
  transferIdentity,
  publishableTransfers,
  transfersForTeam,
  logExcludedTransfers,
  logDuplicateTransfers
};
