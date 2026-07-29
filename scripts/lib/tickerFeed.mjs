/**
 * SON DAKİKA BANDI — DERLEME KATMANI.
 *
 * İçerik kararı burada VERİLMEZ. Hangi kaynak, hangi sıra, hangi rozet
 * sorularının tek yetkili cevabı `services/tickerService.js`. Bu dosya o
 * cevabı alır ve derlemeye özgü tek bir sorumluluğu ekler:
 *
 *   VERİ GEÇİCİ YOKSA BANT BOŞALMAZ. Kaynaklar bir tur boyunca boş dönerse
 *   (senkron hatası, sağlayıcı kesintisi) en son doğrulanmış liste
 *   `data/ticker-state.json` üzerinden korunur ve durum iç zaman damgasıyla
 *   kaydedilir. Okuyucu gerçek ama eski bir başlık görür, sahte bir "son
 *   dakika" görmez. Hiç doğrulanmış kayıt yoksa uydurma da üretilmez: bant
 *   açıkça "veri bekleniyor" der (`awaiting`).
 *
 * Durum dosyası yalnızca içerik gerçekten değiştiğinde yazılır; aksi hâlde
 * beş dakikalık CI turu sırf zaman damgası değişti diye bir commit ve
 * ardından gereksiz bir dağıtım tetiklerdi.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  AWAITING_NOTE,
  FRESH_WINDOW_HOURS,
  MAX_ITEMS,
  SOURCES,
  composeTickerFeed
} = require("../../services/tickerService.js");

const root = process.cwd();
const STATE_FILE = path.join(root, "data", "ticker-state.json");

export { AWAITING_NOTE, FRESH_WINDOW_HOURS, MAX_ITEMS, SOURCES };

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
 *
 * @param {{now?: Date, sources?: Array}} options
 * @returns {{items: Array, badge: string, fresh: boolean, live: boolean,
 *            awaiting: boolean, note: string|null, generatedAt: string|null,
 *            usedFallback: boolean, sourceReport: Array}}
 */
export function buildTickerFeed(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const feed = composeTickerFeed({ now, sources: options.sources });
  const previous = readState();

  // Doğrulanmış hiçbir öğe kalmadıysa son bilinen liste korunur. Bant boş
  // kalmaz ama uydurma da üretilmez: gösterilen her başlık daha önce
  // doğrulanmış gerçek bir kayıttır.
  if (feed.awaiting) {
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
        live: false,
        awaiting: false,
        note: null,
        generatedAt: previous.generatedAt || null,
        usedFallback: true,
        sourceReport: feed.sourceReport
      };
    }

    // Yedek de yok: bant kaldırılmıyor, eksiklik açıkça yazılıyor.
    if (!previous || previous.items?.length || !previous.fallbackSince) {
      writeState({
        items: [],
        generatedAt: null,
        usedFallback: false,
        fallbackSince: now.toISOString(),
        fallbackReason: "doğrulanmış öğe yok"
      });
    }
    return {
      items: [],
      badge: feed.badge,
      fresh: false,
      live: false,
      awaiting: true,
      note: feed.note || AWAITING_NOTE,
      generatedAt: null,
      usedFallback: false,
      sourceReport: feed.sourceReport
    };
  }

  const unchanged = previous &&
    previous.fresh === feed.fresh &&
    previous.badge === feed.badge &&
    signature(previous.items) === signature(feed.items);
  const generatedAt = unchanged && previous.generatedAt ? previous.generatedAt : now.toISOString();

  if (!unchanged) {
    writeState({
      items: feed.items,
      generatedAt,
      newestItemAgeHours: feed.newestItemAgeHours,
      badge: feed.badge,
      fresh: feed.fresh,
      live: feed.live,
      usedFallback: false
    });
  }

  return {
    items: feed.items,
    badge: feed.badge,
    fresh: feed.fresh,
    live: feed.live,
    awaiting: false,
    note: null,
    generatedAt,
    usedFallback: false,
    sourceReport: feed.sourceReport
  };
}
