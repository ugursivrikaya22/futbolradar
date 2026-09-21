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
  "en/live-football-scores.html",
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
  const { duplicate = false, base = "./", locale = "tr" } = options;
  const itemPath = String(item.href || "").replace(/^\.\//, "");
  const localizedPath = locale === "en" ? itemPath.replace(/^mac-detay\.html(?=\?|$)/, "en/match-detail.html") : itemPath;
  const href = item.href ? `${base}${localizedPath}` : "";
  // Öğe kendi canlı payının bittiği anı yanında taşır; site.js o an geçince
  // öğeyi düşürür. Damga yoksa (başlama saati okunamayan kayıt) öğe
  // düşürülmez — sunucu kapısı da o kaydı saate bakmadan geçiriyor.
  const liveUntil = item.liveUntil ? ` data-live-until="${escapeHtml(item.liveUntil)}"` : "";
  const attributes = `${href ? ` href="${escapeHtml(href)}"` : ""}${duplicate ? ' tabindex="-1"' : ""}${liveUntil}`;
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
 * Kayan şerit. Canlı maç yoksa "boş" yer tutucu metni yine burada
 * basılır (uydurma yapılmaz), ama sarmalayıcı `.live-scores-ticker`
 * öğedeki `data-empty` işaretine göre page.css'te `display: none` ile
 * gizlenir — bant boşken sayfada içeriksiz bir çubuk asılı kalmaz.
 *
 * Süre öğe başına 5sn, 18-45sn arasında — transfer bandının 9sn/34-80sn'ine
 * göre belirgin biçimde daha hızlı. Tamamı /1.2 ile bölünür (%20 daha hızlı
 * kaydırma — süre kısaldıkça hız aynı oranda artar).
 *
 * Boş şeridin işaretlemesi `data-live-scores-empty` taşır: site.js son öğe
 * de süresi dolup düştüğünde şeridi TAM OLARAK bu hâle getirir. İki yol
 * (derlemede boş / tarayıcıda boşalmış) aynı DOM'a çıkmalı, yoksa bandın
 * boş hâli nereden geldiğine göre farklı görünürdü.
 */
/**
 * Boş şerit — hem derlemede canlı maç yokken hem de tarayıcıda son öğe
 * süresi dolup düştüğünde basılan TEK biçim. `data-live-scores-empty`
 * site.js'in aynı işaretlemeyi yeniden üretebilmesi için burada.
 */
export function emptyTrack(locale) {
  return `<div class="live-scores-ticker__track is-static" data-live-scores-track data-live-scores-empty>
            <div class="live-scores-ticker__group"><span class="live-scores-ticker__empty">${stringsFor(locale).empty}</span></div>
          </div>`;
}

export function liveTickerTrack(records, options = {}) {
  const { locale, base } = options;
  const items = Array.isArray(records) ? records.filter(Boolean) : [];

  if (!items.length) {
    return emptyTrack(locale);
  }

  const duration = Math.max(18, Math.min(45, items.length * 5)) / 1.2;
  const primary = items.map((item) => liveTickerItem(item, { duplicate: false, base, locale })).join("");
  const duplicate = items.map((item) => liveTickerItem(item, { duplicate: true, base, locale })).join("");

  // DERLEME ANI ŞERİDİN ÜSTÜNE YAZILIR.
  //
  // Ön derleme bir ANDIR: "89'" yazan statik bant bir dakika sonra yalan
  // söyler, bir gün sonra beş gün önce oynanmış maçı canlı gösterir. Statik
  // HTML kendi kendini düzeltemez çünkü içinde zaman yoktur. Bu damga o
  // zamanı işaretlemesine izin verir: istemci (app.js neutralizeStaleLive)
  // damgayı okur ve tazelik ömrünü aşmış bandı boş duruma çevirir —
  // API'ye hiç bağlanmadan, ilk boyamadan önce.
  const renderedAt = Number.isFinite(options.renderedAt)
    ? new Date(options.renderedAt).toISOString()
    : new Date().toISOString();

  return `<div class="live-scores-ticker__track" style="--live-ticker-duration:${duration}s" data-live-scores-track data-live-rendered-at="${escapeHtml(renderedAt)}">
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

  // Boş metin bandın üzerinde: site.js son öğeyi düşürdüğünde doğru dildeki
  // cümleyi yazabilmeli ve hangi dilde olduğunu DOM'dan okumalı — sözlüğün
  // ikinci bir kopyası istemciye inmemeli.
  return `<div class="live-scores-ticker"${items.length ? "" : " data-empty"} data-component="LiveScoresTicker"${liveAttributes} data-live-empty-text="${escapeHtml(text.empty)}" role="region" aria-label="${escapeHtml(text.region)}">
      <div class="container-wide live-scores-ticker__inner">
        <span class="live-scores-ticker__label"><i class="live-pulse" aria-hidden="true"></i>${escapeHtml(text.label)}</span>
        <div class="live-scores-ticker__viewport" aria-live="polite">
          ${liveTickerTrack(items, { locale, base })}
        </div>
      </div>
    </div>`;
}
