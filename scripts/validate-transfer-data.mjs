import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const transfers = JSON.parse(fs.readFileSync(path.join(root, "data", "transfers.json"), "utf8"));
const teams = JSON.parse(fs.readFileSync(path.join(root, "data", "teams.json"), "utf8"));
const playersPayload = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
const players = Array.isArray(playersPayload) ? playersPayload : playersPayload.data || playersPayload.players || [];
const errors = [];
const warnings = [];
const ids = new Set();
const requiredText = ["id", "playerName", "date", "fromTeam", "toTeam", "type", "status", "sourceName", "sourceUrl", "lastVerifiedAt"];

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function validUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeText(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

for (const [index, transfer] of transfers.entries()) {
  const label = transfer.id || `index:${index}`;
  for (const field of requiredText) {
    if (!String(transfer[field] ?? "").trim()) errors.push(`${label}: ${field} boş olamaz.`);
  }
  if (ids.has(transfer.id)) errors.push(`${label}: yinelenen transfer id.`);
  ids.add(transfer.id);
  if (!validDate(transfer.date)) errors.push(`${label}: date YYYY-MM-DD formatında değil.`);
  if (Number.isNaN(Date.parse(transfer.lastVerifiedAt))) errors.push(`${label}: lastVerifiedAt geçerli ISO tarih değil.`);
  if (!validUrl(transfer.sourceUrl)) errors.push(`${label}: sourceUrl geçerli bir HTTP(S) adresi değil.`);
  if (transfer.fromTeam === transfer.toTeam) errors.push(`${label}: eski ve yeni takım aynı olamaz.`);
  if (transfer.status !== "confirmed") warnings.push(`${label}: kesinleşmemiş kayıt kullanıcı akışına girebilir.`);
  if (typeof transfer.confidence !== "number" || transfer.confidence < 0 || transfer.confidence > 1) {
    errors.push(`${label}: confidence 0 ile 1 arasında sayı olmalı.`);
  }
  if (transfer.feeEur !== null && (!Number.isFinite(transfer.feeEur) || transfer.feeEur < 0)) {
    errors.push(`${label}: feeEur null veya negatif olmayan sayı olmalı.`);
  }
}

for (const team of teams) {
  for (const recent of team.recentTransfers || []) {
    const matching = transfers.find((transfer) => {
      if (transfer.playerName !== recent.playerName || transfer.date !== recent.date) return false;
      return recent.direction === "out" ? transfer.fromTeam === team.name : transfer.toTeam === team.name;
    });
    if (!matching) warnings.push(`${team.name}: ${recent.playerName} son transfer kaydı ana transfer listesinde bulunamadı.`);
  }
}

for (const transfer of transfers) {
  const relatedTeams = [
    { name: transfer.fromTeam, direction: "out" },
    { name: transfer.toTeam, direction: "in" }
  ];

  for (const related of relatedTeams) {
    const team = teams.find((item) => normalizeText(item.name) === normalizeText(related.name));
    if (!team) continue;

    const matching = (team.recentTransfers || []).find((recent) =>
      recent.playerName === transfer.playerName &&
      recent.date === transfer.date &&
      recent.direction === related.direction
    );
    if (!matching) {
      errors.push(`${team.name}: ${transfer.playerName} ${related.direction} hareketi recentTransfers listesinde eksik.`);
    }
  }
}

const latestTransfersByPlayer = new Map();
for (const transfer of transfers.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
  if (transfer.playerId) latestTransfersByPlayer.set(transfer.playerId, transfer);
}

for (const player of players) {
  const transfer = latestTransfersByPlayer.get(player.id);
  if (!transfer) continue;

  const currentTeam = player.currentTeam || player.team;
  if (normalizeText(currentTeam) !== normalizeText(transfer.toTeam)) {
    errors.push(`${player.name}: currentTeam (${currentTeam}) son transferdeki yeni kulup (${transfer.toTeam}) ile uyusmuyor.`);
  }

  const history = Array.isArray(player.transferHistory) ? player.transferHistory : [];
  const matchingHistory = history.find((item) => item.date === transfer.date && normalizeText(item.toTeam) === normalizeText(transfer.toTeam));
  if (!matchingHistory) {
    errors.push(`${player.name}: ana transfer kaydi oyuncunun transferHistory listesinde eksik.`);
  }
}

if (warnings.length) {
  console.warn(`Transfer validation warnings (${warnings.length}):`);
  warnings.forEach((warning) => console.warn(`- ${warning}`));
}

if (errors.length) {
  console.error(`Transfer validation failed (${errors.length}):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Transfer validation passed: ${transfers.length} confirmed records checked.`);
