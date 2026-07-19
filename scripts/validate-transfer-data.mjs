import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const transfers = JSON.parse(fs.readFileSync(path.join(root, "data", "transfers.json"), "utf8"));
const teams = JSON.parse(fs.readFileSync(path.join(root, "data", "teams.json"), "utf8"));
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
