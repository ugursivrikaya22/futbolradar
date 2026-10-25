#!/usr/bin/env node
/**
 * SÜPER LOTO SONUÇ ÇEKİCİ — yalnızca resmî Milli Piyango kaynağı.
 *
 * Saatlik zamanlanmış güncellemenin (run-scheduled-update.mjs → sourceSteps)
 * bir adımıdır; yeni cron ya da workflow değişikliği gerektirmez. Ucuzdur:
 *   • Perşembe 21:00 – Cuma 23:59 (Europe/Istanbul) penceresi dışında hiç
 *     istek atmaz (`--force` hariç).
 *   • Bu haftanın Perşembe çekilişi zaten kayıtlıysa istek atmaz.
 *   • Pencere içinde koşu başına en fazla bir istek (uç nokta başına).
 *
 * KURAL: sayı uydurulmaz. Yanıt doğrulanamazsa (HTTP hatası, WAF/403,
 * beklenmeyen biçim, 6 farklı 1–60 sayısı yok) dosyaya HİÇBİR ŞEY yazılmaz.
 * Erişim engellenirse aşılmaya çalışılmaz (proxy, başlık taklidi yok).
 *
 * Kullanım: node scripts/fetch-super-loto.mjs [--apply] [--force] [--url=<resmî uç nokta>]
 * SUPER_LOTO_SOURCE_URL ortam değişkeni varsayılan uç noktayı değiştirir.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isValidDraw, normalizeDraws } from "./lib/superLoto.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(root, "data", "super-loto.json");
export const OFFICIAL_HOSTS = ["www.millipiyangoonline.com", "millipiyangoonline.com", "www.millipiyango.gov.tr", "www.mpi.gov.tr"];
export const DEFAULT_URL = "https://www.millipiyangoonline.com/sisalsans/result.superloto.json";
const USER_AGENT = "FutbolRadarBot/1.0 (+https://www.futbolradar.com/iletisim)";

export function istanbulNow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: parts.weekday };
}

/** Bu çekiliş haftasının Perşembe tarihi (Perş/Cuma için). Pencere dışında null. */
export function drawWindow(now = new Date()) {
  const t = istanbulNow(now);
  if (t.weekday === "Thu" && t.hour >= 21) return t.date;
  if (t.weekday === "Fri") {
    const d = new Date(`${t.date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

const toIsoDate = (value) => {
  const s = String(value ?? "").trim();
  let m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})[./](\d{2})[./](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
};

const toNumbers = (value) => {
  if (Array.isArray(value)) return value.map((v) => Number(typeof v === "object" && v ? v.number ?? v.value : v));
  if (typeof value === "string") return value.split(/[#,\s-]+/).filter(Boolean).map(Number);
  return null;
};

/**
 * Resmî yanıtı çekiliş kayıtlarına çevirir. Birkaç bilinen biçimi tanır;
 * tanımadığı her şeyi atar. Dönen kayıtlar isValidDraw'dan geçmiştir.
 */
export function parseOfficial(payload, sourceUrl, fetchedAt) {
  const out = [];
  const visit = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 6) return;
    if (Array.isArray(node)) { node.forEach((n) => visit(n, depth + 1)); return; }
    const numbers = toNumbers(node.rakamlar ?? node.numbers ?? node.winningNumbers ?? node.drawnNumbers ?? node.winningNumber);
    const date = toIsoDate(node.cekilisTarihi ?? node.drawDate ?? node.date ?? node.drawTime);
    if (numbers && date) {
      const prizesRaw = node.bilenKisiler ?? node.prizes ?? node.winners ?? null;
      const prizes = Array.isArray(prizesRaw) ? prizesRaw.map((p) => ({
        category: String(p.tur ?? p.category ?? p.typeCode ?? "").replace(/^\$?(\d)_BILEN$/i, "$1 Bilen"),
        winners: Number.isInteger(Number(p.kisiSayisi ?? p.winners ?? p.count)) ? Number(p.kisiSayisi ?? p.winners ?? p.count) : null,
        amount: (p.kisiBasinaDusenIkramiye ?? p.amount ?? null) === null ? null : String(p.kisiBasinaDusenIkramiye ?? p.amount)
      })).filter((p) => p.category) : [];
      const draw = { date, numbers, drawNo: node.hafta ?? node.drawNo ?? node.drawId ?? undefined, prizes, sourceUrl, fetchedAt };
      if (draw.drawNo === undefined) delete draw.drawNo;
      if (isValidDraw(draw)) out.push(draw);
    }
    for (const value of Object.values(node)) if (value && typeof value === "object") visit(value, depth + 1);
  };
  visit(payload, 0);
  return out;
}

export function mergeDraws(existing, incoming) {
  const known = new Set(existing.map((d) => d.date));
  const added = incoming.filter((d) => !known.has(d.date));
  return { added, draws: normalizeDraws([...existing, ...added]) };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const urlArg = process.argv.slice(2).find((a) => a.startsWith("--url="));
  const url = urlArg ? urlArg.slice(6) : (process.env.SUPER_LOTO_SOURCE_URL || DEFAULT_URL);
  const host = new URL(url).hostname;
  if (!OFFICIAL_HOSTS.includes(host)) { console.error(`[super-loto] resmî olmayan kaynak reddedildi: ${host}`); process.exitCode = 1; return; }

  const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const existing = normalizeDraws(data.draws);
  const week = drawWindow();
  if (!args.has("--force")) {
    if (!week) { console.log("[super-loto] çekiliş penceresi dışında (Perş 21:00 – Cuma); istek atılmadı."); return; }
    if (existing.some((d) => d.date >= week)) { console.log(`[super-loto] ${week} çekilişi zaten kayıtlı; istek atılmadı.`); return; }
  }

  let response;
  try {
    response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
  } catch (error) {
    console.warn(`[super-loto] resmî kaynağa ulaşılamadı: ${error.message}. Veri değiştirilmedi.`);
    return;
  }
  if (!response.ok) { console.warn(`[super-loto] resmî kaynak HTTP ${response.status} döndü (erişim engeli olabilir; aşılmaya çalışılmaz). Veri değiştirilmedi.`); return; }
  let payload;
  try { payload = await response.json(); } catch { console.warn("[super-loto] resmî yanıt JSON değil; veri değiştirilmedi."); return; }

  const parsed = parseOfficial(payload, url, new Date().toISOString());
  const { added, draws } = mergeDraws(existing, parsed);
  if (!added.length) { console.log(`[super-loto] yeni çekiliş yok (yanıtta ${parsed.length} geçerli kayıt).`); return; }
  console.log(`[super-loto] ${added.length} yeni çekiliş: ${added.map((d) => d.date).join(", ")}`);
  if (!args.has("--apply")) { console.log("[super-loto] --apply verilmedi; dosya yazılmadı."); return; }
  fs.writeFileSync(FILE, `${JSON.stringify({ ...data, draws }, null, 2)}\n`, "utf8");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
