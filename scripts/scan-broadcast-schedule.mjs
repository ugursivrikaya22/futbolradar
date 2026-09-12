#!/usr/bin/env node
/**
 * YARININ MAÇLARI HANGİ KANALDA — GÜNLÜK OTOMATİK TARAMA.
 *
 * NEDEN VAR. Yayın kanalı bilgisi siteye maç günü, çoğu zaman maç
 * başladıktan sonra düşüyordu: sağlayıcının `strTVStation` alanı fikstür
 * yayımlandığında boş geliyor ve ancak yayıncı akışını açıklayınca
 * doluyor. Okuyucunun sorusu ise bir gün önce soruluyor — "yarın maç kaçta,
 * hangi kanalda". Bu betik o boşluğu kapatır: her gün YARININ öncelikli
 * maçlarını çıkarır ve kanallarını yayıncıların KENDİ akışlarından
 * doğrulamaya çalışır.
 *
 * TAHMİN ETMEZ, DOĞRULAR. `services/broadcastRights.js` turnuva bazlı bir
 * hak haritası taşır ama o harita ekrana hiç yazılmaz; yalnızca hangi
 * yayıncının akışını indireceğimizi söyler. Kanal adı ancak o akışta maçın
 * kendisi bulunduğunda yayımlanır. Akış açılmazsa, maç akışta geçmiyorsa
 * ya da eşleşme belirsizse kayıt yazılmaz ve sayfa "Yayın bilgisi
 * bekleniyor" gösterir. Yani ağ hatası sessiz bir yanlışa değil, görünür
 * bir eksiğe dönüşür.
 *
 * DEĞİŞİKLİĞİ DÜZELTİR. Çıktı dosyası her koşuda SIFIRDAN yazılır. Maç
 * saati kayarsa ya da yayıncı değişirse eski kayıt taşınmaz: bir sonraki
 * koşu yeni gerçeği yazar. Bu yüzden gün içinde birkaç kez koşar
 * (bkz. .github/workflows/broadcast-schedule.yml).
 *
 * GEÇMİŞ GÜN TUTULMAZ. Yalnızca bugün ve yarın taranır; dünün kaydı
 * kendiliğinden düşer, çünkü dosya sıfırdan yazılıyor.
 *
 * Kullanım:
 *   node scripts/scan-broadcast-schedule.mjs            (kuru koşu, yazmaz)
 *   node scripts/scan-broadcast-schedule.mjs --apply
 *   node scripts/scan-broadcast-schedule.mjs --apply --days=3
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

const {
  competitionDisplayName,
  primaryBroadcast,
  istanbulDayOffset,
  selectBroadcastMatches
} = require("../services/broadcastSchedule.js");
const { broadcastersForCompetition, allBroadcasters } = require("../services/broadcastRights.js");
const { resolveCompetitionId } = require("../services/competitionCatalog.js");

const OUTPUT = path.join(root, "data", "broadcast-schedule.json");
const apply = process.argv.includes("--apply");
const daysArg = process.argv.find((arg) => arg.startsWith("--days="));
const DAY_COUNT = Math.max(1, Math.min(7, Number(daysArg ? daysArg.split("=")[1] : 2) || 2));
const FETCH_TIMEOUT_MS = 15000;

function log(line) {
  console.log(`[broadcast-scan] ${line}`);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** Fikstür kaynağı: sync-fixture-calendar çıktısı, yoksa küratörlü maçlar. */
function allMatches() {
  const calendar = readJson(path.join(root, "data", "fixture-calendar.json"), {});
  const fromCalendar = Array.isArray(calendar.matches) ? calendar.matches : [];
  const curated = readJson(path.join(root, "data", "matches.json"), []);
  const fromCurated = Array.isArray(curated) ? curated : (curated.matches || []);
  return [...fromCalendar, ...fromCurated];
}

/**
 * Takım adını akış metninde aramaya uygun hâle getirir.
 *
 * Yayın akışları kulüp adını sitenin kullandığı biçimde yazmıyor:
 * "Fenerbahçe" kimi akışta "FENERBAHCE", kimi akışta "Fenerbahçe SK".
 * Aksan, büyük/küçük harf ve kulüp son ekleri düşürülür; geriye ayırt
 * edici gövde kalır.
 */
function searchKey(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/\b(sk|as|fk|fc|cf|ac|sc|spor kul[uü]b[uü]|kul[uü]b[uü])\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * İki takım adı AYNI SATIRDA mı geçiyor?
 *
 * "İki ad da sayfada var" yetmez. Haftalık bir yayın akışında onlarca maç
 * listelenir; Liverpool bir satırda, Fulham bambaşka bir satırda geçtiğinde
 * sayfa ikisini de içerir ama Liverpool-Fulham maçını listelemiyor
 * olabilir. Eşleşmeyi maça bağlayan şey yakınlıktır: iki ad birbirinden en
 * fazla `WINDOW` karakter uzakta olmalı ki aynı program satırından
 * geldiklerine güvenelim.
 *
 * Pencere bilerek geniş (bir akış satırı saat + turnuva + iki takım + kanal
 * taşıyabiliyor) ama sayfa boyuna göre hâlâ çok dar; yan yana olmayan iki
 * adı eler.
 */
const PROXIMITY_WINDOW = 120;

function mentionedTogether(haystack, homeTeam, awayTeam) {
  const home = searchKey(homeTeam);
  const away = searchKey(awayTeam);
  if (home.length < 4 || away.length < 4) return false;

  let index = haystack.indexOf(home);
  while (index !== -1) {
    const from = Math.max(0, index - PROXIMITY_WINDOW);
    const to = index + home.length + PROXIMITY_WINDOW;
    if (haystack.slice(from, to).includes(away)) return true;
    index = haystack.indexOf(home, index + 1);
  }
  return false;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "FutbolRadarBot/1.0 (+https://www.futbolradar.com)" }
    });
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}`, body: "" };
    return { ok: true, reason: "", body: await response.text() };
  } catch (error) {
    return { ok: false, reason: (error && error.name === "AbortError") ? "zaman aşımı" : String((error && error.message) || error), body: "" };
  } finally {
    clearTimeout(timer);
  }
}

/** HTML'i aranabilir düz metne indirger. */
function plainText(html) {
  return searchKey(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "));
}

/**
 * Akış metninde geçen kanal adı.
 *
 * Yayıncının kalıbı eşleşirse akışta OKUNAN ad döner (ör. "beIN Sports 1");
 * kalıp numara yakalamazsa yayıncının dar etiketi kullanılır ("beIN
 * Sports"). Numara asla uydurulmaz.
 */
function channelFromSchedule(broadcaster, rawHtml) {
  const match = String(rawHtml || "").match(broadcaster.channelPattern);
  if (!match) return broadcaster.label;
  const captured = (match[1] || "").trim();
  if (!captured) return broadcaster.label;
  if (/^\d$/.test(captured)) return `${broadcaster.label} ${captured}`;
  return `TRT ${captured.replace(/\s+/g, " ")}`.replace(/^TRT TRT/, "TRT");
}

async function main() {
  const days = Array.from({ length: DAY_COUNT }, (_, index) => istanbulDayOffset(index));
  const matches = allMatches();

  const targets = [];
  for (const day of days) {
    for (const match of selectBroadcastMatches(matches, { day })) {
      targets.push({ day, match });
    }
  }
  log(`${days.join(", ")} → ${targets.length} öncelikli maç.`);

  // Akışlar bir kez indirilir; aynı yayıncı onlarca maçta geçiyor.
  const schedules = new Map();
  for (const broadcaster of allBroadcasters()) {
    const result = await fetchText(broadcaster.scheduleUrl);
    schedules.set(broadcaster.key, {
      broadcaster,
      ok: result.ok,
      reason: result.reason,
      raw: result.body,
      plain: result.ok ? plainText(result.body) : ""
    });
    log(`${broadcaster.key}: ${result.ok ? `akış alındı (${result.body.length} bayt)` : `alınamadı — ${result.reason}`}`);
  }

  const records = [];
  let pending = 0;
  for (const { day, match } of targets) {
    const competitionId = resolveCompetitionId(match) || "";
    const candidates = broadcastersForCompetition(competitionId);
    const channels = [];
    let sourceUrl = "";

    for (const broadcaster of candidates) {
      const schedule = schedules.get(broadcaster.key);
      if (!schedule || !schedule.ok || !schedule.plain) continue;
      // İki ad AYNI SATIRDA geçmeli — sayfada ayrı ayrı bulunmaları
      // maçın listelendiğini kanıtlamaz (bkz. `mentionedTogether`).
      if (!mentionedTogether(schedule.plain, match.homeTeam, match.awayTeam)) continue;
      const channel = channelFromSchedule(broadcaster, schedule.raw);
      if (channel && !channels.includes(channel)) channels.push(channel);
      if (!sourceUrl) sourceUrl = broadcaster.scheduleUrl;
    }

    // Sağlayıcı ya da elle doğrulama zaten maça özel bir kanal verdiyse o
    // da geçerlidir; hak haritasından değil, maç kaydından gelir.
    //
    // `primaryBroadcast` bilerek kullanılıyor: `broadcastChannel` bu
    // betiğin KENDİ çıktısını da okur ve tarayıcı kendi eski kaydını
    // "sağlayıcı verisi" sanıp kaynaksız yeniden yazardı.
    const primary = primaryBroadcast(match);
    if (!channels.length && primary) {
      channels.push(primary.channel);
      sourceUrl = primary.sourceUrl;
    }

    // KAYNAKSIZ KANAL YAYIMLANMAZ. Adı bilip nereden bildiğimizi
    // gösteremiyorsak okuyucuya "bekleniyor" demek daha dürüst.
    if (!/^https:\/\//.test(sourceUrl)) {
      pending += 1;
      continue;
    }

    if (!channels.length) {
      pending += 1;
      continue;
    }

    records.push({
      date: day,
      homeTeam: String(match.homeTeam || ""),
      awayTeam: String(match.awayTeam || ""),
      providerId: String(match.providerId || match.id || ""),
      kickoff: String(match.kickoff || ""),
      competition: competitionDisplayName(match),
      turkey: channels.join(" / "),
      sourceUrl,
      verifiedAt: new Date().toISOString()
    });
  }

  const payload = {
    _comment: "OTOMATİK YAYIN TARAMASI ÇIKTISI — elle düzenlenmez. scripts/scan-broadcast-schedule.mjs her koşuda yeniden yazar. Elle doğrulanmış kayıtlar data/broadcast-verifications.json içindedir ve buradaki kayıtları EZER (bkz. services/broadcastSchedule.js#verifiedBroadcast).",
    scannedAt: new Date().toISOString(),
    days,
    records
  };

  log(`${records.length} maçın kanalı doğrulandı, ${pending} maç "bekleniyor" kalıyor.`);

  if (!apply) {
    log("kuru koşu — dosya yazılmadı (--apply ile yazar).");
    return;
  }

  const previous = readJson(OUTPUT, { records: [] });
  const before = new Map((previous.records || []).map((row) => [`${row.date}|${row.homeTeam}|${row.awayTeam}`, row]));
  for (const row of records) {
    const key = `${row.date}|${row.homeTeam}|${row.awayTeam}`;
    const old = before.get(key);
    if (old && old.turkey !== row.turkey) log(`DEĞİŞTİ ${key}: "${old.turkey}" → "${row.turkey}"`);
    if (old && old.kickoff !== row.kickoff) log(`SAAT DEĞİŞTİ ${key}: "${old.kickoff}" → "${row.kickoff}"`);
  }

  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  log(`yazıldı: ${path.relative(root, OUTPUT)}`);
}

main().catch((error) => {
  console.error(`[broadcast-scan] koşu düştü: ${(error && error.message) || error}`);
  // TARAMA DÜŞERSE SİTE DÜŞMEZ. Çıktı dosyası olduğu gibi kalır, sayfalar
  // son bilinen doğrulamayı ya da "bekleniyor" satırını gösterir. Bu adımın
  // derlemeyi kırması, ağdaki geçici bir sorunu yayın kesintisine çevirirdi.
  process.exitCode = 0;
});
