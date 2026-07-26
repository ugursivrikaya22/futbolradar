/**
 * SON DAKİKA BANDI — beslenme kuralı
 *
 * Bant iki doğrulanmış kaynaktan beslenir ve elle güncelleme gerektirmez:
 *
 *   1. Sitenin kendi doğrulanmış maç kaydı (data/matches.json). Bu kayıtlar
 *      yayın politikasından (services/matchEligibility.js) geçmiştir ve CI'ın
 *      beş dakikalık döngüsünde tazelenir; biten bir maçın skoru bandı
 *      kendiliğinden günceller.
 *   2. Doğrulanmış transfer hareketleri (data/transfers.json, status
 *      "confirmed" ve kaynak bağlantısı olanlar).
 *   3. Editoryal haber kayıtları (data/news.json), yalnızca status "verified"
 *      ve kaynak bağlantısı varsa.
 *
 * TAZELİK: "Son Dakika" bir zaman iddiasıdır. Bant daha önce on bir güne
 * kadar eski haberi bu rozetle gösteriyordu — içerik gerçekti ama sunum
 * yanıltıcıydı. Artık her öğenin bir zaman damgası olmak zorunda ve rozet
 * banttaki EN TAZE öğeye göre belirlenir:
 *   • en taze öğe FRESH_WINDOW_HOURS içindeyse  -> "Son Dakika"
 *   • değilse                                    -> "Gündem"
 * Hiçbir durumda uydurma başlık üretilmez.
 *
 * VERİ GEÇİCİ YOKSA: liste boşalırsa bant kaldırılmaz; en son doğrulanmış
 * öğeler korunur (data/ticker-state.json) ve durum iç zaman damgasıyla
 * kaydedilir. Okuyucu gerçek ama eski bir başlık görür, sahte bir "son
 * dakika" görmez.
 *
 * KALABALIK OLMASIN: bant en fazla MAX_ITEMS öğe taşır.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

/** "Son Dakika" rozetinin geçerli sayıldığı pencere. */
export const FRESH_WINDOW_HOURS = 36;

/** Banda alınabilecek en eski içerik. Bundan eskisi hiç gösterilmez. */
const MAX_AGE_HOURS = 24 * 7;

/** Bant en fazla bu kadar öğe taşır; şerit kalabalıklaşmamalı. */
const MAX_ITEMS = 6;

const STATE_FILE = path.join(root, "data", "ticker-state.json");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "data", file), "utf8"));
  } catch {
    return fallback;
  }
}

function asArray(payload, ...keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (payload && Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function hoursSince(value, now) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return Infinity;
  return (now.getTime() - time) / 3600000;
}

function hasScore(match) {
  const score = match && match.score;
  return Boolean(score) &&
    score.home !== null && score.home !== undefined &&
    score.away !== null && score.away !== undefined;
}

/** Maç kayıtları: canlı skor, biten sonuç ve bugünün başlama saatleri. */
function matchItems(now) {
  const matches = asArray(readJson("matches.json", []), "matches");
  const items = [];

  for (const match of matches) {
    if (!match || !match.homeTeam || !match.awayTeam) continue;

    const status = String(match.status || "").toUpperCase();
    const stamp = match.lastVerifiedAt || match.fetchedAt || match.kickoff;
    const age = hoursSince(stamp, now);
    if (age > MAX_AGE_HOURS) continue;

    const live = ["LIVE", "IN_PLAY", "1H", "2H", "HT", "HALFTIME", "ET"].includes(status);
    const finished = ["FINISHED", "FT", "AET", "PEN"].includes(status);

    if (live && hasScore(match)) {
      items.push({
        label: "Canlı",
        text: `${match.homeTeam} ${match.score.home}-${match.score.away} ${match.awayTeam}`,
        href: `canli-skor.html#${match.id}`,
        at: stamp,
        priority: 0
      });
    } else if (finished && hasScore(match)) {
      items.push({
        label: "Sonuç",
        text: `${match.homeTeam} ${match.score.home}-${match.score.away} ${match.awayTeam}`,
        href: `canli-skor.html#${match.id}`,
        at: stamp,
        priority: 1
      });
    }
  }

  return items;
}

/** Doğrulanmış transferler; kaynağı olmayan kayıt banda girmez. */
function transferItems(now) {
  const transfers = asArray(readJson("transfers.json", []), "transfers");

  return transfers
    .filter((item) =>
      item &&
      item.playerName &&
      item.toTeam &&
      String(item.status || "").toLowerCase() === "confirmed" &&
      item.sourceUrl)
    .filter((item) => hoursSince(item.date, now) <= MAX_AGE_HOURS)
    .map((item) => ({
      label: "Transfer",
      text: `${item.playerName}, ${item.toTeam} kadrosunda`,
      href: item.sourceUrl,
      at: item.date,
      priority: 2
    }));
}

/** Editoryal haberler; yalnızca doğrulanmış ve kaynaklı olanlar. */
function newsItems(now) {
  const news = asArray(readJson("news.json", []), "news", "items");

  return news
    .filter((item) =>
      item &&
      item.title &&
      String(item.status || "").toLowerCase() === "verified" &&
      item.url)
    .filter((item) => hoursSince(item.publishedAt, now) <= MAX_AGE_HOURS)
    .map((item) => ({
      label: item.category || "Gündem",
      text: item.title,
      href: item.url,
      at: item.publishedAt,
      priority: 3
    }));
}

function dedupe(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = item.text.toLocaleLowerCase("tr");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

/** İki listenin aynı içeriği taşıyıp taşımadığını karşılaştırmak için. */
function signature(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => `${item.label}|${item.text}|${item.href}|${item.at}`)
    .join("\n");
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeState(state) {
  try {
    fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch {
    /* Durum dosyası yazılamazsa bant yine çalışır; yalnızca yedek kaybolur. */
  }
}

/**
 * Bandın içeriğini ve rozetini üretir.
 * @returns {{items: Array, badge: string, fresh: boolean, generatedAt: string, usedFallback: boolean}}
 */
export function buildTickerFeed(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();

  const collected = dedupe([
    ...matchItems(now),
    ...transferItems(now),
    ...newsItems(now)
  ]).sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    return String(right.at || "").localeCompare(String(left.at || ""));
  });

  const items = collected.slice(0, MAX_ITEMS);
  const previous = readState();

  // Doğrulanmış hiçbir öğe kalmadıysa son bilinen liste korunur. Bant boş
  // kalmaz ama uydurma da üretilmez: gösterilen her başlık daha önce
  // doğrulanmış gerçek bir kayıttır.
  if (!items.length) {
    if (previous && Array.isArray(previous.items) && previous.items.length) {
      // fallbackSince kesintinin ilk görüldüğü andır; kesinti sürerken
      // yeniden yazılmaz, böylece her tur yeni bir commit üretmez.
      if (!previous.usedFallback || !previous.fallbackSince) {
        writeState({
          ...previous,
          usedFallback: true,
          fallbackSince: now.toISOString(),
          fallbackReason: "doğrulanmış taze öğe bulunamadı"
        });
      }
      return {
        items: previous.items,
        badge: "Gündem",
        fresh: false,
        generatedAt: previous.generatedAt || null,
        usedFallback: true
      };
    }

    if (!previous || previous.items?.length || !previous.fallbackSince) {
      writeState({
        items: [],
        generatedAt: null,
        usedFallback: false,
        fallbackSince: now.toISOString(),
        fallbackReason: "doğrulanmış öğe yok"
      });
    }
    return { items: [], badge: "Gündem", fresh: false, generatedAt: null, usedFallback: false };
  }

  const newestAge = Math.min(...items.map((item) => hoursSince(item.at, now)));
  const fresh = newestAge <= FRESH_WINDOW_HOURS;

  // Durum dosyası yalnızca içerik gerçekten değiştiğinde yazılır. Aksi hâlde
  // her beş dakikalık CI turu sırf zaman damgası değişti diye bir commit ve
  // ardından gereksiz bir dağıtım tetiklerdi.
  const unchanged = previous &&
    previous.fresh === fresh &&
    signature(previous.items) === signature(items);
  const generatedAt = unchanged && previous.generatedAt ? previous.generatedAt : now.toISOString();

  if (!unchanged) {
    writeState({
      items,
      generatedAt,
      newestItemAgeHours: Number.isFinite(newestAge) ? Math.round(newestAge * 10) / 10 : null,
      fresh,
      usedFallback: false
    });
  }

  return {
    items,
    badge: fresh ? "Son Dakika" : "Gündem",
    fresh,
    generatedAt,
    usedFallback: false
  };
}
