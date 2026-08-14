/**
 * İNGİLİZCE BANT BESLEMESİ — YAPILANDIRILMIŞ VERİDEN, ÇEVİRİDEN DEĞİL.
 *
 * Türkçe bant (scripts/lib/tickerFeed.mjs) doğrulanmış Türkçe editoryal
 * başlıklardan besleniyor. O başlıkları makine çevirisiyle İngilizceye
 * basmak yasak; ama İngilizce sayfada bandın HİÇ olmaması da tasarım
 * eşitliğini bozuyordu.
 *
 * Çözüm: bandın İngilizce sürümü, dilden bağımsız YAPISAL veriden üretilir —
 * kesinleşen transferler (oyuncu/kulüp/tür alanları yapılandırılmış),
 * tamamlanan Türk maç sonuçları (skor) ve sıradaki Süper Lig başlama saati.
 * Her öğe İngilizce ŞABLONDAN geçer; hiçbir Türkçe serbest metin çevrilmez,
 * hiçbir bilgi uydurulmaz. Türkçe banttaki resmî açıklama başlıkları burada
 * bilinçli olarak YOK: onlar çevrilmeden İngilizce sayfaya giremez.
 *
 * Görsel bileşen aynı: scripts/lib/layout.mjs#newsTicker, locale="en".
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { canonicalStatus, istanbulDay } = require("../../services/matchStatus.js");
const { formatTime, formatWeekday } = require("../../services/i18n.js");

const root = process.cwd();
const MAX_ITEMS = 8;

/** Türkçe transfer türü → İngilizce karşılık. Bilinmeyen tür yazılmaz. */
const TRANSFER_TYPE_EN = Object.freeze({
  "serbest transfer": "Free transfer",
  "sozlesme sonu": "End of contract",
  "sözleşme sonu": "End of contract",
  "sozlesme feshi": "Contract termination",
  "sözleşme feshi": "Contract termination",
  "kiralik": "Loan",
  "kiralık": "Loan",
  "bonservisli transfer": "Permanent transfer",
  "bonservis": "Permanent transfer",
  "satin alma": "Permanent transfer",
  "satın alma": "Permanent transfer"
});

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "data", file), "utf8"));
  } catch {
    return fallback;
  }
}

export function transferTypeEn(value) {
  return TRANSFER_TYPE_EN[String(value || "").trim().toLowerCase()] || null;
}

/** Kulüp adları aynen kalır; kulüp olmayan kadro durumu çevrilir. */
export function transferTeamEn(value) {
  const team = String(value || "").trim();
  return team.toLocaleLowerCase("tr-TR") === "serbest oyuncu" ? "Free agent" : team;
}

function todayIstanbul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

export function buildEnTickerItems() {
  const items = [];
  const today = todayIstanbul();

  // 1) Kesinleşen transferler — yalnızca status=confirmed ve alanları tam olanlar.
  const transfersDoc = readJson("transfers.json", {});
  const transfers = Array.isArray(transfersDoc) ? transfersDoc : (transfersDoc.transfers || []);
  const confirmed = transfers
    .filter((row) => String(row.status || "").toLowerCase() === "confirmed")
    .filter((row) => row.playerName && row.toTeam)
    .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")))
    .slice(0, 4);
  for (const row of confirmed) {
    const type = transferTypeEn(row.type);
    items.push({
      label: "Transfer",
      text: `${row.playerName} joins ${transferTeamEn(row.toTeam)}${type ? ` (${type})` : ""}`,
      href: row.sourceUrl || null
    });
  }

  // 2) Tamamlanan Türk maçları (bugün/dün) — skor sağlayıcı verisi.
  const teams = readJson("teams.json", []);
  const turkish = new Set(teams.map((team) => String(team.name || "").toLowerCase()));
  const calendar = readJson("fixture-calendar.json", { matches: [] });
  const finished = (calendar.matches || [])
    .filter((match) => canonicalStatus(match.status) === "FINISHED")
    .filter((match) => match.score && match.score.home !== null && match.score.away !== null)
    .filter((match) => turkish.has(String(match.homeTeam || "").toLowerCase()) || turkish.has(String(match.awayTeam || "").toLowerCase()))
    .sort((left, right) => String(right.kickoff || "").localeCompare(String(left.kickoff || "")))
    .slice(0, 3);
  for (const match of finished) {
    items.push({
      label: "Full Time",
      text: `${match.homeTeam} ${match.score.home}–${match.score.away} ${match.awayTeam}`,
      href: "en/analysis.html"
    });
  }

  // 3) Sıradaki Süper Lig / Türk takımı başlama saati.
  const upcoming = (calendar.matches || [])
    .filter((match) => canonicalStatus(match.status) === "SCHEDULED")
    .filter((match) => istanbulDay(match.kickoff) >= today)
    .filter((match) => turkish.has(String(match.homeTeam || "").toLowerCase()) || turkish.has(String(match.awayTeam || "").toLowerCase()))
    .sort((left, right) => String(left.kickoff || "").localeCompare(String(right.kickoff || "")))
    .slice(0, 3);
  for (const match of upcoming) {
    const day = istanbulDay(match.kickoff) === today ? "today" : formatWeekday(match.kickoff, "en");
    items.push({
      label: "Kick-off",
      text: `${match.homeTeam} vs ${match.awayTeam} — ${day} ${formatTime(match.kickoff, "en")}`,
      href: "en/todays-matches.html"
    });
  }

  return items.slice(0, MAX_ITEMS);
}
