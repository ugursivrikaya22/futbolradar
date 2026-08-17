/**
 * CANLI SKORLAR BANDININ TEK İŞARETLEME KAYNAĞI.
 *
 * Transfer Radarı bandının yerini alır (bkz. scripts/lib/transferTicker.mjs,
 * artık kullanılmıyor) — aynı üç yerde (Türkçe ön derleme, İngilizce
 * üretici, istemci) tek DOM kaynağı olması gerekliliği burada da geçerli.
 *
 * SEÇİM buraya AİT DEĞİL: hangi maçın "şu an canlı" sayıldığı
 * services/liveScoresTicker.js'te. Burası yalnızca "seçilmiş kayıtlar nasıl
 * çizilir" sorusunu cevaplar.
 *
 * Kayan animasyon saf CSS. Transfer bandına göre süre kısaltıldı (öğe
 * başına 9sn yerine 5sn, 34-80sn yerine 18-45sn) — canlı skorların "modern
 * ve hızlı" akması istendi; transfer bandının ağır temposu buraya taşınmadı.
 */

/**
 * BANT HANGİ SAYFALARDA ÇIKAR. Transfer bandıyla AYNI liste — sayfa seçimi
 * "bandın nerede çıkacağı" kararıdır, hangi bant olduğu değil.
 */
export const LIVE_TICKER_PAGES = [
  "bugunun-maclari.html",
  "canli-skor.html",
  "mac-sonuclari.html",
  "super-lig-fikstur.html",
  "mac-merkezi.html",
  "transfer-radari.html",
  "takimlar.html",
  "puan-durumu.html",
  "analizler.html",
  "oyuncu-radari.html",
  "istatistik-merkezi.html",
  "momentum.html",
  "gol-kralligi.html",
  "haberler.html",
  "arsiv.html",
  "kose-yazilari.html",
  "en/todays-matches.html",
  "en/live-scores.html",
  "en/analysis.html",
  "en/teams.html",
  "en/standings.html"
];

/** Bandı kendi işaretlemesinde taşıyan sayfalar (enjeksiyon buralara dokunmaz). */
export const LIVE_TICKER_OWN_PAGES = ["index.html", "en/index.html"];

const STRINGS = {
  tr: {
    label: "Canlı Skorlar",
    region: "Canlı Skorlar",
    empty: "Şu anda canlı maç yok."
  },
  en: {
    label: "Live Scores",
    region: "Live Scores",
    empty: "No live matches at the moment."
  }
};

function stringsFor(locale) {
  return locale === "en" ? STRINGS.en : STRINGS.tr;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function scoreText(value) {
  return value === null || value === undefined ? "–" : String(value);
}

/**
 * Bant öğesi. Maç ayrıntısına bağlanır — canlı skor iddia edilirken
 * okuyucuya gidecek bir yer de vermek gerekir.
 */
export function liveTickerItem(item, options = {}) {
  const { duplicate = false, base = "./" } = options;
  const href = item.href ? `${base}${String(item.href).replace(/^\.\//, "")}` : "";
  const attributes = `${href ? ` href="${escapeHtml(href)}"` : ""}${duplicate ? ' tabindex="-1"' : ""}`;
  const tag = item.href ? "a" : "span";
  const aria = `${item.league} | ${item.homeTeam} ${scoreText(item.homeScore)} - ${scoreText(item.awayScore)} ${item.awayTeam} | ${item.minuteOrStatus}`;
  return `<${tag} class="live-scores-ticker__item"${attributes} aria-label="${escapeHtml(aria)}">` +
    `<span class="live-scores-ticker__league">${escapeHtml(item.league)}</span>` +
    `<span class="live-scores-ticker__separator" aria-hidden="true">|</span>` +
    `<strong class="live-scores-ticker__match">` +
    `<span class="live-scores-ticker__team">${escapeHtml(item.homeTeam)}</span>` +
    `<span class="live-scores-ticker__score">${escapeHtml(scoreText(item.homeScore))} - ${escapeHtml(scoreText(item.awayScore))}</span>` +
    `<span class="live-scores-ticker__team">${escapeHtml(item.awayTeam)}</span>` +
    `</strong>` +
    `<span class="live-scores-ticker__separator" aria-hidden="true">|</span>` +
    `<span class="live-scores-ticker__minute${item.isHalftime ? " is-halftime" : ""}"><i class="live-pulse" aria-hidden="true"></i>${escapeHtml(item.minuteOrStatus)}</span>` +
    `</${tag}>`;
}

/**
 * Kayan şerit. Canlı maç yoksa yer tutucu KALIR — uydurma yapılmaz, boş
 * durum açıkça yazılır.
 *
 * Süre öğe başına 5sn, 18-45sn arasında — transfer bandının 9sn/34-80sn'ine
 * göre belirgin biçimde daha hızlı.
 */
export function liveTickerTrack(records, options = {}) {
  const { locale, base } = options;
  const items = Array.isArray(records) ? records.filter(Boolean) : [];

  if (!items.length) {
    return `<div class="live-scores-ticker__track is-static" data-live-scores-track>
            <div class="live-scores-ticker__group"><span class="live-scores-ticker__empty">${stringsFor(locale).empty}</span></div>
          </div>`;
  }

  const duration = Math.max(18, Math.min(45, items.length * 5));
  const primary = items.map((item) => liveTickerItem(item, { duplicate: false, base })).join("");
  const duplicate = items.map((item) => liveTickerItem(item, { duplicate: true, base })).join("");
  return `<div class="live-scores-ticker__track" style="--live-ticker-duration:${duration}s" data-live-scores-track>
            <div class="live-scores-ticker__group">${primary}</div>
            <div class="live-scores-ticker__group" aria-hidden="true">${duplicate}</div>
          </div>`;
}

/**
 * Şeridi saran tam blok — bandın ana sayfa dışındaki sayfalara girmesi
 * bunun üzerinden olur.
 *
 * Canlı maç yoksa ve sayfa bandı zorunlu tutmuyorsa (`keepEmpty`/`live`
 * değilse) bant HİÇ basılmaz — boş bir şerit sayfanın tepesinde hiçbir şey
 * söylemeyen bir çubuk bırakırdı.
 */
export function liveTickerBlock(records, options = {}) {
  const { locale, live = false, keepEmpty = false, base } = options;
  const items = Array.isArray(records) ? records.filter(Boolean) : [];
  const text = stringsFor(locale);

  if (!items.length && !live && !keepEmpty) {
    return "";
  }

  const liveAttributes = live
    ? ' data-api-target="live-scores-ticker" data-static-fallback="true" data-live-source="/api/matches?status=live" data-source="loading"'
    : ' data-source="static"';

  return `<div class="live-scores-ticker"${items.length ? "" : " data-empty"} data-component="LiveScoresTicker"${liveAttributes} role="region" aria-label="${escapeHtml(text.region)}">
      <div class="container-wide live-scores-ticker__inner">
        <span class="live-scores-ticker__label"><i class="live-pulse" aria-hidden="true"></i>${escapeHtml(text.label)}</span>
        <div class="live-scores-ticker__viewport" aria-live="polite">
          ${liveTickerTrack(items, { locale, base })}
        </div>
      </div>
    </div>`;
}
