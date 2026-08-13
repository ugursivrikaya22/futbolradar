/**
 * TRANSFER RADARI BANDININ TEK İŞARETLEME KAYNAĞI.
 *
 * Bant üç ayrı yerde elle yazılmıştı: Türkçe ön derleme
 * (prerender-core-pages.mjs), İngilizce üretici (generate-en-pages.mjs) ve
 * istemci (app.js). Üçü de aynı DOM'u kuruyordu ama ayrı ayrı; biri
 * değiştiğinde diğerlerinin sessizce geride kalması an meselesiydi. Bandı
 * ana sayfa dışına taşırken dördüncü bir kopya eklemek yerine işaretleme
 * buraya alındı.
 *
 * SEÇİM buraya AİT DEĞİL: hangi transferin banda gireceği, sıralaması ve
 * durum anahtarı services/transferRadarTicker.js'te. Burası yalnızca
 * "seçilmiş kayıtlar nasıl çizilir" sorusunu cevaplar. İki sorumluluğu
 * ayrı tutmak, dil eklemenin seçim kurallarına dokunmamasını sağlıyor.
 *
 * Kayan animasyon saf CSS; bant JavaScript olmadan da çalışır. İkinci grup
 * (aria-hidden) kaymanın kesintisiz görünmesi için birebir kopyadır —
 * ekran okuyucu onu atlar, klavye `tabindex="-1"` ile içinden geçmez.
 */

/**
 * BANT HANGİ SAYFALARDA ÇIKAR.
 *
 * Haber bandı her sayfada; transfer bandı yalnızca ana gezinme sayfalarında.
 * Ayrım bilinçli: bant sayfanın tepesinden ~40px yer alıyor ve içeriği aşağı
 * kaydırıyor. 4.900 üretilmiş detay sayfasının (tek maç, tek oyuncu, tek
 * haber) okuyucusu belirli bir şeye bakmaya gelmiştir; oraya ikinci bir
 * kayan şerit koymak, aradığı şeyi ekranın dışına itmek olurdu.
 *
 * Liste ELLE tutulur ve buradan hem enjeksiyon hem test okur. "Tüm ana
 * sayfalar" gibi bir kural yazmak, ileride eklenen her sayfanın habersizce
 * bant kazanmasına yol açardı — bandın nerede çıktığı görünür bir karar
 * olarak kalsın.
 *
 * Ana sayfalar listede DEĞİL: orada bant sayfanın kendi işaretlemesinde
 * duruyor (Türkçe tarafta istemci canlı tazeliyor).
 */
export const TRANSFER_TICKER_PAGES = [
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
export const TRANSFER_TICKER_OWN_PAGES = ["index.html", "en/index.html"];

const STRINGS = {
  tr: {
    label: "Transfer Radarı",
    region: "Transfer Radarı",
    breaking: "SON DAKİKA",
    fallbackLead: "TRANSFER",
    from: "Nereden:",
    empty: "Transfer güncellemeleri hazırlanıyor.",
    status: {
      Official: "Resmî",
      AgreementReported: "Anlaşma iddiası",
      Rumor: "İddia",
      Talks: "Görüşme",
      Loan: "Kiralık"
    }
  },
  en: {
    label: "Transfer Radar",
    region: "Transfer Radar",
    breaking: "BREAKING",
    fallbackLead: "TRANSFER",
    from: "From:",
    empty: "Transfer updates are being prepared.",
    status: {
      Official: "Official",
      AgreementReported: "Agreement reported",
      Rumor: "Reported",
      Talks: "In talks",
      Loan: "Loan"
    }
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

export function transferStatusLabel(key, locale) {
  return stringsFor(locale).status[key] || key;
}

/**
 * Bant öğesi. Bağlantısı olmayan kayıt `<span>` olur — tıklanacak bir yeri
 * yokken `<a>` yazmak kullanıcıya olmayan bir söz vermektir.
 */
export function transferTickerItem(item, options = {}) {
  const { locale, duplicate = false, sourceRel = "nofollow noopener noreferrer" } = options;
  const text = stringsFor(locale);
  const external = /^https?:/i.test(item.url);
  const tag = item.url ? "a" : "span";
  const attributes = item.url
    ? ` href="${escapeHtml(item.url)}"${external ? ` target="_blank" rel="${sourceRel}"` : ""}${duplicate ? ' tabindex="-1"' : ""}`
    : "";
  const lead = item.isBreaking ? text.breaking : (item.dateLabel || text.fallbackLead);
  const statusLabel = transferStatusLabel(item.statusKey, locale);
  const aria = `${lead} | ${item.playerName} → ${item.toTeam} | ${text.from} ${item.fromTeam} | ${statusLabel}`;
  return `<${tag} class="transfer-radar-ticker__item"${attributes} aria-label="${escapeHtml(aria)}">` +
    `<span class="transfer-radar-ticker__breaking${item.isBreaking ? "" : " is-dated"}">${escapeHtml(lead)}</span>` +
    `<span class="transfer-radar-ticker__separator" aria-hidden="true">|</span>` +
    `<strong>${escapeHtml(item.playerName)} <span aria-hidden="true">→</span> ${escapeHtml(item.toTeam)}</strong>` +
    `<span class="transfer-radar-ticker__separator" aria-hidden="true">|</span>` +
    `<span>${text.from} ${escapeHtml(item.fromTeam)}</span>` +
    `<span class="transfer-radar-ticker__separator" aria-hidden="true">|</span>` +
    // Sınıf anahtarı İngilizce kalır (CSS onunla renklendiriyor).
    `<span class="transfer-radar-ticker__status is-${item.statusKey.toLowerCase()}">${escapeHtml(statusLabel)}</span>` +
    `</${tag}>`;
}

/**
 * Kayan şerit. Veri yoksa yer tutucu KALIR — uydurma yapılmaz.
 *
 * Süre app.js ile aynı formülden gelir: öğe başına 9 sn, 34-80 sn arasında.
 * İstemci bandı canlı veriyle tazelediğinde aynı hesabı yaptığı için şerit
 * yerinden oynamaz.
 */
export function transferTickerTrack(records, options = {}) {
  const { locale, sourceRel } = options;
  const items = Array.isArray(records) ? records.filter(Boolean) : [];

  if (!items.length) {
    return `<div class="transfer-radar-ticker__track is-static" data-transfer-radar-track>
            <div class="transfer-radar-ticker__group"><span class="transfer-radar-ticker__empty">${stringsFor(locale).empty}</span></div>
          </div>`;
  }

  const duration = Math.max(34, Math.min(80, items.length * 9));
  const primary = items.map((item) => transferTickerItem(item, { locale, duplicate: false, sourceRel })).join("");
  const duplicate = items.map((item) => transferTickerItem(item, { locale, duplicate: true, sourceRel })).join("");
  return `<div class="transfer-radar-ticker__track" style="--transfer-ticker-duration:${duration}s" data-transfer-radar-track>
            <div class="transfer-radar-ticker__group">${primary}</div>
            <div class="transfer-radar-ticker__group" aria-hidden="true">${duplicate}</div>
          </div>`;
}

/**
 * Şeridi saran tam blok — bandın ana sayfa dışındaki sayfalara girmesi
 * bunun üzerinden olur.
 *
 * `live` seçeneği istemcinin bandı tazeleyip tazelemeyeceğini söyler.
 * Ana sayfada bant `/api/transfers`ten canlı güncelleniyor; diğer
 * sayfalarda derleme çıktısı saatlik yenilendiği için statik kalır. Bu
 * ayrım niteliklerde görünür kılınıyor: `data-source="loading"` istemciye
 * "burayı sen dolduracaksın" der, `data-source="static"` demez. Yanlış
 * niteliği vermek, istemcinin dokunmayacağı bir bandı sonsuza kadar
 * "yükleniyor" durumunda bırakırdı.
 */
export function transferTickerBlock(records, options = {}) {
  const { locale, sourceRel, live = false, keepEmpty = false } = options;
  const items = Array.isArray(records) ? records.filter(Boolean) : [];
  const text = stringsFor(locale);

  // Veri yokken bant SONRADAN EKLENEN sayfalarda hiç basılmıyor: haber bandı
  // da öğe yoksa çizilmiyor (layout.mjs newsTicker) ve boş bir şerit sayfanın
  // tepesinde hiçbir şey söylemeyen bir çubuk bırakırdı.
  //
  // Ana sayfalar istisnadır ve istisna İSTEYEREK belirtilir: orada bant
  // sayfanın sabit bir parçası, veri gecikince kaybolup düzeni oynatması
  // istenmez. Türkçe tarafta konteyner elle yazılı ve istemci dolduruyor
  // (`live`), İngilizce tarafta yer tutucu korunuyor (`keepEmpty`).
  if (!items.length && !live && !keepEmpty) {
    return "";
  }

  const liveAttributes = live
    ? ' data-api-target="transfer-radar" data-static-fallback="true" data-transfer-source="/api/transfers" data-source="loading"'
    : ' data-source="static"';

  return `<div class="transfer-radar-ticker" data-component="TransferRadarTicker"${liveAttributes} role="region" aria-label="${escapeHtml(text.region)}">
      <div class="container-wide transfer-radar-ticker__inner">
        <span class="transfer-radar-ticker__label">${escapeHtml(text.label)}</span>
        <div class="transfer-radar-ticker__viewport" aria-live="polite">
          ${transferTickerTrack(items, { locale, sourceRel })}
        </div>
      </div>
    </div>`;
}
