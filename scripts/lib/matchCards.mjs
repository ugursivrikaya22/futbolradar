/**
 * MAÇ VE TAKIM KARTLARI — TEK BİLEŞEN, İKİ DİL.
 *
 * `.fixture-card`, `.fixture-row`, `.trend-card` ve transfer paneli
 * işaretlemesi iki üreticide birden yazılmıştı: Türkçe sayfalar için
 * prerender-core-pages.mjs, İngilizce sayfalar için generate-en-pages.mjs.
 * İki kopya, Türkçe tarafta yapılan her kart değişikliğinin İngilizce
 * tarafta SESSİZCE eksik kalması demekti — tam da iki dilli sürümün
 * yasaklaması gereken şey.
 *
 * Kural: işaretleme BURADA, bir kez. Metinler sözlükten (`t(key, locale)`),
 * durum etiketi gibi dil+veri bileşimleri çağırandan gelir. Türkçe çıktı
 * birebir korunur: buradaki şablonlar prerender'daki eski şablonların
 * karakteri karakterine taşınmış hâlidir; sözlükteki Türkçe karşılıklar
 * eski sabit dizgelerle aynıdır.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeLocale, t } = require("../../services/i18n.js");
const { canonicalStatus, isDisplayableLive, LIVE_STATES, PLAYED_STATES } = require("../../services/matchStatus.js");
const { sameClub } = require("../../services/superLigTeams.js");

/**
 * SÜRESİ GEÇEN "RESMÎ İLK 11" UYARISININ EŞİĞİ — TEK YERDE.
 *
 * Eşik iki üreticide birden (prerender-core-pages.mjs ve
 * generate-en-pages.mjs) ayrı ayrı yazılıydı; İngilizce tarafın notu bile
 * gerekçe için Türkçe tarafa işaret ediyordu. İki kopya, eşiği bir tarafta
 * değiştirmenin diğer tarafı SESSİZCE eski değerde bırakması demekti —
 * kartın bir dilde durup öbüründe kalkması. Kural burada da aynı: değer
 * BURADA, bir kez.
 *
 * Değer 3 saatten 2 saat 15 dakikaya çekildi. 3 saat, ilk 11 kartını maç
 * bittikten sonra yaklaşık bir saat daha "SON DAKİKA" rozetiyle ana
 * sayfada tutuyordu: 20:00'de başlayan Gaziantep FK-Fenerbahçe 21:55'te
 * bitti, kart 23:00'e kadar kalacaktı. 2 saat 15 dakika, uzatmalar ve
 * devre arası dahil normal bir maçı (90 + ~15 + uzatma) rahatça kapsar,
 * ama bitişten sonra kartı saatlerce taşımaz.
 *
 * Bu YALNIZCA yedek sinyaldir. Asıl sinyal maçın veri katmanında
 * doğrulanmış olarak bitmesidir (prerender'daki isVerifiedFinalMatch);
 * o geldiği anda kart zaten eşik beklenmeden kalkar. Eşik, maç kaydı
 * takvimde yoksa ya da sonuç henüz doğrulanmamışsa devreye girer.
 */
export const LINEUP_ALERT_STALE_MS = (2 * 60 + 15) * 60 * 1000;

/**
 * Uyarı, başlama saatinin üzerinden eşikten fazla geçtiği için artık
 * basılmamalı mı? Zaman damgası okunamıyorsa kart BASILIR (kaynağı olan
 * bir kaydı, yalnızca tarihi ayrıştıramadık diye düşürmeyiz).
 *
 * KAYIT SİLİNMEZ — geçmiş maç verisi korunur, yalnızca ekrana basılması
 * durur.
 */
export function isLineupAlertStale(alert, now = Date.now()) {
  const kickoffMs = Date.parse((alert && alert.kickoff) || "");
  if (!Number.isFinite(kickoffMs)) return false;
  return now - kickoffMs > LINEUP_ALERT_STALE_MS;
}

/**
 * RESMÎ İLK 11 UYARISI — kalıcı analiz altyapısına (tahmin/matchup/rakip
 * kıyası) hiç dokunmaz. `data/official-lineup-alerts.json`, kulübün
 * kendi açıklamasından ELLE girilmiş, kaynaklı bir kayıttır (bkz. o
 * dosyanın başındaki not); burada yalnızca GÖRÜNTÜLENİR.
 *
 * "Doğrulanmadan yayınlanmaz" kuralı burada da geçerli: `startingXI`
 * kaydında AD zorunludur, forma numarası ise İSTEĞE BAĞLIDIR ve yalnızca
 * resmî esame gibi numarayı da veren bir kaynaktan geldiyse taşınır
 * (numara/mevki bilinmiyorsa uydurulmaz), kaynak adı ve bağlantısı
 * ZORUNLU — kaynağı gösterilemeyen bir kart basılmaz.
 */
export function officialLineupAlertHtml(alert, locale) {
  if (!alert || !Array.isArray(alert.startingXI) || !alert.startingXI.length || !alert.sourceUrl) return "";
  const loc = normalizeLocale(locale);
  const players = alert.startingXI.map((player) => {
    // Forma numarası YALNIZCA kayıtta varsa basılır (resmî esameden gelir);
    // bilinmiyorsa sıra numarası gibi bir vekil değer uydurulmaz.
    const number = Number.isFinite(Number(player.number)) && player.number !== null && player.number !== ""
      ? `<b class="lineup-alert-number">${escapeHtml(player.number)}</b>`
      : "";
    return `<li class="lineup-alert-player">${number}<span>${escapeHtml(player.name)}</span></li>`;
  }).join("");

  return `<div class="lineup-alert" data-card="official-lineup-alert" data-match="${escapeHtml(alert.matchId || "")}">` +
    `<div class="lineup-alert-head">` +
    `<span class="card-badge breaking">${escapeHtml(t("transfer.badge.breaking", loc))}</span>` +
    `<h2>${escapeHtml(alert.team)} ${escapeHtml(t("lineup.alert.title", loc))}</h2>` +
    `<span class="lineup-alert-fixture">${escapeHtml(alert.homeTeam)} – ${escapeHtml(alert.awayTeam)}</span>` +
    `</div>` +
    `<ol class="lineup-alert-grid">${players}</ol>` +
    `<div class="lineup-alert-foot"><span>${escapeHtml(t("transfer.source.label", loc))}: ${escapeHtml(alert.sourceName)}</span>` +
    `<a class="detail-link" href="${escapeHtml(alert.sourceUrl)}" target="_blank" rel="nofollow noopener noreferrer">${escapeHtml(t("lineup.alert.openSource", loc))}</a></div>` +
    `</div>`;
}

/** `.player-metric` — küçük istatistik çipi; birden çok panelde kullanılır. */
export function compactMetricHtml(label, value) {
  return `<div class="player-metric"><span>${escapeHtml(label)}</span><b>${escapeHtml(value === undefined || value === null || value === "" ? "–" : value)}</b></div>`;
}

export function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function fixtureTeamInitials(name) {
  const clean = String(name || "").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || clean.charAt(0).toUpperCase();
}

/**
 * Lig rozeti. Renk sınıfı lig adının kararlı karmasından türetilir; aynı
 * lig her sayfada aynı renktedir. İstemcideki `leagueMarkHtml` ile aynı
 * kural (app.js).
 */
export function leagueMarkHtml(league) {
  const name = String(league || "").trim();
  if (!name) return "";

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toLocaleUpperCase("tr"))
    .join("");

  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 997;
  }

  return `<i class="league-mark league-mark-${hash % 5}" aria-hidden="true">${escapeHtml(initials)}</i>`;
}

export function fixtureRow(name, score, otherScore) {
  const winner = score !== null && otherScore !== null && Number(score) > Number(otherScore);
  return `<div class="fixture-row${winner ? " is-winner" : ""}">` +
    `<span class="fixture-row-fallback" aria-hidden="true">${escapeHtml(fixtureTeamInitials(name))}</span>` +
    `<span class="fixture-row-name">${escapeHtml(name)}</span>` +
    `<span class="fixture-row-score">${escapeHtml(score === null ? "–" : score)}</span>` +
    `</div>`;
}

/**
 * KARTIN YAYIN SATIRI — takım adlarının ve saatin hemen altında, tek satır.
 *
 * İki durum vardır ve `services/broadcastSchedule.js#broadcastLabel` hangisi
 * olduğunu söyler: kanal doğrulandıysa adı, doğrulanmadıysa "Yayın bilgisi
 * bekleniyor". Bileşen burada KARAR VERMEZ — kanal adı uydurmak ya da
 * "bilinmiyorsa satırı hiç çizmemek" gibi bir seçim yapmaz; ikisi de
 * okuyucuya yalan söylerdi (biri yanlış kanal, diğeri "bu maç yayınlanmıyor"
 * izlenimi).
 *
 * Etiket verilmediğinde satır çizilmez: yayın bilgisinin anlamlı olmadığı
 * kart türleri (biten maç, arşiv) çağırandan `broadcast` almaz.
 *
 * @param {{state:string,text:string,sourceUrl?:string}} [label]
 */
export function broadcastLineHtml(label) {
  if (!label || !label.text) return "";
  const pending = label.state !== "verified";
  // KARTIN TEK BAĞLANTISI MAÇ BAĞLANTISIDIR.
  //
  // Yayın satırı ilk yazıldığında kanal adı yayıncının akışına bağlanıyordu.
  // İki sorun çıkardı. Görünen: kartta artık iki hedef vardı ve yayıncı
  // bağlantısı işaretlemede maç bağlantısından ÖNCE geliyordu, yani "kartın
  // bağlantısı" diye okunan ilk <a> maç yerine yayıncıya gidiyordu
  // (test-clickable-browser bunu "en horizontal sliders and card surfaces"
  // vakasında yakaladı: beklenen maç adresi yerine /yayin-akisi okundu).
  // Görünmeyen: kart bir maça açılan tek bir yüzeydir; içine ikinci ve dış
  // bir hedef koymak, kartın ne yaptığını belirsizleştirir.
  //
  // Kaynak kaybolmuyor: doğrulamanın nereden geldiği `data-broadcast-source`
  // olarak işaretlemede duruyor ve okuyucuya gösterilen künye bağlantısı
  // maç ayrıntısı ile "hangi kanalda" sayfalarında zaten var.
  const source = label.sourceUrl && !pending ? ` data-broadcast-source="${escapeHtml(label.sourceUrl)}"` : "";
  return `<div class="fixture-card-broadcast${pending ? " is-unknown" : ""}" data-broadcast="${pending ? "pending" : "verified"}"${source}>` +
    `<span class="fixture-card-broadcast-icon" aria-hidden="true">📺</span><span>${escapeHtml(label.text)}</span></div>`;
}

/**
 * Maç kartı.
 *
 * Durum ETİKETİ çağırandan gelir: Türkçe taraf kendi durum sözlüğünü ve
 * başlık önceliğini uygular, İngilizce taraf `statusLabelFor` kullanır.
 * Bileşen yalnızca işaretlemeyi sahiplenir — davranış farkı veriden,
 * görünüm farkı buradan doğamaz.
 *
 * @param {object} options
 *   id           data-match değeri (yoksa öznitelik yazılmaz)
 *   league       lig adı (görünen)
 *   live         kart canlı vurgusu alsın mı
 *   stateClass   "is-live" | "is-final" | ""
 *   stateLabel   görünen durum metni
 *   homeTeam/awayTeam, homeScore/awayScore (null = skor yok)
 *   formHtml     hazır form bloğu (yalnızca Türkçe tarafta dolu)
 *   actionHref   kart altındaki bağlantının hedefi
 *   broadcast    yayın etiketi ({state,text,sourceUrl}); verilmezse satır
 *                çizilmez — bkz. broadcastLineHtml
 *   withMatchClick  data-match-click özniteliği (analytics; Türkçe taraf)
 *   quickLinksHtml  kart altına, eylem bağlantısının ALTINA eklenen ek
 *                   iç-link düğmeleri (ör. "Analiz — Puan Durumu — Takım
 *                   Formu"); yalnızca çağıran bir şey verirse basılır —
 *                   varsayılan davranış (mevcut tüm sayfalar) değişmez.
 *   locale
 */
export function fixtureCard(options) {
  const locale = normalizeLocale(options.locale);
  const leagueLabel = options.league || t("card.leagueFallback", locale);
  return `<article class="fixture-card${options.live ? " is-live" : ""}" data-card="fixture"${options.id ? ` data-match="${escapeHtml(options.id)}"` : ""}>
    <div class="fixture-card-top"><span class="fixture-card-league">${leagueMarkHtml(leagueLabel)}${escapeHtml(leagueLabel)}</span><span class="fixture-card-state ${options.stateClass || ""}">${escapeHtml(options.stateLabel || "")}</span></div>
    <div class="fixture-card-rows">${fixtureRow(options.homeTeam, options.homeScore, options.awayScore)}${fixtureRow(options.awayTeam, options.awayScore, options.homeScore)}</div>
    ${broadcastLineHtml(options.broadcast)}
    ${options.formHtml ? `<div class="fixture-card-meta">${options.formHtml}</div>` : ""}
    <a class="fixture-card-action" href="${escapeHtml(options.actionHref)}"${options.withMatchClick ? " data-match-click" : ""}>${escapeHtml(t("card.openMatchDetail", locale))}</a>${options.quickLinksHtml ? `
    <div class="fixture-card-quicklinks">${options.quickLinksHtml}</div>` : ""}
  </article>`;
}

/**
 * LİG BLOĞU (.league-match-group).
 *
 * İstemci maç programı sayfasını lig bloklarına ayırıyor, statik yedek ise
 * kartları tek uzun liste hâlinde basıyordu. İki sonucu vardı: JavaScript
 * yüklendiğinde liste yeniden çiziliyor ve sayfa yerinden oynuyordu; ve
 * tarayıcı yalnızca statik hâli gördüğü için hangi maçın hangi turnuvaya
 * ait olduğu HTML'de hiç yazmıyordu.
 *
 * İşaretleme istemcideki `renderMatchesByLeague` ile bilerek özdeştir.
 * Sayı etiketi ("12 maç") çağırandan gelir; dil farkı buradan doğamaz.
 */
export function leagueMatchGroup(options) {
  const league = String(options.league || "");
  return `<section class="league-match-group league-block" data-league-group="${escapeHtml(league)}">` +
    `<div class="league-block-head"><span class="league-block-title">${escapeHtml(league)}</span>` +
    `<b class="league-block-count">${escapeHtml(options.countLabel || "")}</b></div>` +
    `<div class="league-match-grid">${options.cardsHtml || ""}</div>` +
    `</section>`;
}

/**
 * Trend takım kartı (.trend-card). Form noktaları çağırandan hazır gelir:
 * Türkçe noktalar G/B/M, İngilizce W/D/L harfleriyle çizilir.
 */
export function trendCard(options) {
  const locale = normalizeLocale(options.locale);
  const action = options.actionHref
    ? `<a class="fixture-card-action" href="${escapeHtml(options.actionHref)}">${escapeHtml(t("card.openTeamRadar", locale))}</a>`
    : "";
  return `<article class="trend-card" data-card="trend-team"${options.id ? ` data-team="${escapeHtml(options.id)}"` : ""}>
      <div class="trend-card-head"><span class="trend-card-avatar" aria-hidden="true">${escapeHtml(fixtureTeamInitials(options.name))}</span><span><strong>${escapeHtml(options.name)}</strong><span>${escapeHtml(options.leagueLabel || t("card.teamFallback", locale))}</span></span><b class="trend-card-score">${escapeHtml(options.momentum ?? "–")}</b></div>
      ${options.formDotsHtml || ""}
      <dl class="trend-card-stats"><div><dt>${escapeHtml(t("trend.attack", locale))}</dt><dd>${escapeHtml(options.attack ?? "–")}</dd></div><div><dt>${escapeHtml(t("trend.defence", locale))}</dt><dd>${escapeHtml(options.defense ?? "–")}</dd></div><div><dt>${escapeHtml(t("trend.form", locale))}</dt><dd>${escapeHtml(options.formScore ?? "–")}</dd></div></dl>
      ${action}
    </article>`;
}

/**
 * Ana sayfa transfer paneli (.home-transfer-watch-shell içeriği).
 * Satır bağlantı hedefleri çağırandan gelir; Türkçe taraf transfer-radari
 * sayfasına, İngilizce taraf kaynağa ya da kendi köküne bağlar.
 */
/**
 * Bölüm başlığı — `.section-head` düzeni Türkçe ve İngilizce sayfalarda
 * aynı. Üç EN üretici (ana sayfa, takım, maç/oyuncu) bunu ayrı ayrı
 * yazıyordu; artık tek yerde.
 */
export function sectionHead(options) {
  const locale = normalizeLocale(options.locale);
  const link = options.linkHref
    ? `<a class="section-link" href="${escapeHtml(options.linkHref)}">${escapeHtml(options.linkText || t("common.viewAll", locale))}</a>`
    : "";
  return `<div class="section-head"><div class="section-title"><span class="section-kicker">${escapeHtml(options.kicker)}</span><h2 id="${escapeHtml(options.titleId)}">${escapeHtml(options.title)}</h2>${options.lead ? `<p>${escapeHtml(options.lead)}</p>` : ""}</div>${link}</div>`;
}

/** Form noktaları (.form-dots). `win/draw/loss` çağırandan hazır gelir. */
export function formDotsHtml(form, locale) {
  const list = Array.isArray(form) ? form : [];
  if (!list.length) return "";
  const map = normalizeLocale(locale) === "en" ? { win: "W", draw: "D", loss: "L" } : { win: "G", draw: "B", loss: "M" };
  return `<span class="form-dots">${list
    .map((entry) => `<span class="form-dot ${escapeHtml(entry.result || "draw")}">${escapeHtml(map[entry.result] || map.draw)}</span>`)
    .join("")}</span>`;
}

/**
 * DURUM DÜRÜSTLÜĞÜ — TEK YERDE.
 *
 * "Bir transfer, resmî açıklanana kadar tamamlanmış SAYILMAZ" kuralının
 * kod karşılığı. `data/transfers.json`deki `status` alanı zaten bu
 * sözlüğü kullanıyor (confirmed/agreed/negotiating/pending/rumour); bu
 * fonksiyon o alanı OKUYOR, yeniden yorumlamıyor. Rozet rengi ve fiil
 * seçimi buradan geçmeyen hiçbir yerde tekrar karar verilmemeli — aksi
 * hâlde bir gün rozet "İddia" derken cümle "resmen açıkladı" diyebilir.
 */
function transferStatusClass(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "confirmed") return "confirmed";
  if (["agreed", "negotiating", "pending"].includes(normalized)) return "pending";
  return "rumour";
}

function transferStatusLabel(status, locale) {
  const cls = transferStatusClass(status);
  if (cls === "confirmed") return t("transfer.status.confirmed", locale);
  if (cls === "pending") return t("transfer.status.pending", locale);
  return t("transfer.status.rumour", locale);
}

function transferVerbPhrase(status, locale) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "confirmed") return t("transfer.verb.confirmed", locale);
  if (normalized === "agreed") return t("transfer.verb.agreed", locale);
  if (["negotiating", "pending"].includes(normalized)) return t("transfer.verb.pending", locale);
  return t("transfer.verb.rumour", locale);
}

/**
 * "SON DAKİKA" rozeti bir GERÇEK tazelik sinyaline dayanır (kayıt 48
 * saatten yeni), performans ya da önem hakkında bir iddia değildir.
 * `nowMs` çağırandan gelir — üretim betiği kendi referans zamanını
 * seçer, bu fonksiyon `Date.now()`a bağımlı olmaz.
 */
function isBreakingTransfer(dateText, nowMs) {
  const parsed = Date.parse(String(dateText || ""));
  if (!Number.isFinite(parsed)) return false;
  const hours = (nowMs - parsed) / (1000 * 60 * 60);
  return hours >= 0 && hours <= 48;
}

/**
 * Bedel: "Bedelsiz" GERÇEKTEN sıfırdır, bilinmeyen bedel asla 0
 * gösterilmez. Biçim, oyuncu profillerindeki piyasa değeri gösterimiyle
 * aynı ("€3.2M") — sitede iki farklı bedel biçimi okuyucuyu şaşırtırdı.
 */
function transferFeeLabel(leader, locale) {
  if (leader.fee) return leader.fee;
  const feeEur = Number(leader.feeEur);
  if (Number.isFinite(feeEur) && feeEur === 0) return t("transfer.fee.free", locale);
  if (Number.isFinite(feeEur) && feeEur > 0) {
    return feeEur >= 1_000_000
      ? `€${(Math.round(feeEur / 100_000) / 10).toFixed(1)}M`
      : `€${feeEur.toLocaleString(locale === "en" ? "en-GB" : "tr-TR")}`;
  }
  return t("transfer.fee.undisclosed", locale);
}

/**
 * ÖZET CÜMLESİ — yalnızca GERÇEK alanlardan kurulur (takım, oyuncu,
 * durum, bedel). Oyuncunun yeteneği/performansı hakkında hiçbir iddia
 * taşımaz; "ne oldu"yu anlatır, "ne olacağını" değil.
 */
function transferSummarySentence(leader, locale) {
  const verb = transferVerbPhrase(leader.status, locale);
  const fee = transferFeeLabel(leader, locale);
  const feeClause = fee && fee !== t("transfer.fee.undisclosed", locale) ? ` (${fee})` : "";
  return locale === "en"
    ? `${leader.toTeam} ${verb} ${leader.playerName}${leader.fromTeam ? ` from ${leader.fromTeam}` : ""}${feeClause}.`
    : `${leader.toTeam}, ${leader.playerName}${leader.fromTeam ? ` (${leader.fromTeam})` : ""} ${verb}${feeClause}.`;
}

/**
 * FUTBOLRADAR YORUMU — mevki biliniyorsa kadro planlaması çerçevesinde
 * tek cümle, bilinmiyorsa uydurma bir gerekçe üretmek yerine nötr bir
 * "izlenmeye değer" ifadesi. İkisi de sonuç/performans iddiası taşımaz.
 */
function transferTakeSentence(leader, locale) {
  const subject = leader.toTeam || leader.playerName;
  const suffix = leader.position
    ? t("transfer.take.withPosition", locale).replace("{position}", leader.position)
    : t("transfer.take.generic", locale);
  return locale === "en" ? `${subject} ${suffix}` : `${subject}, ${suffix}`;
}

export function transferWatchShell(options) {
  const locale = normalizeLocale(options.locale);
  const leader = options.leader;
  const nowMs = options.nowMs || Date.now();
  const statusClass = transferStatusClass(leader.status);
  const breaking = isBreakingTransfer(leader.date, nowMs);
  const fullList = [leader, ...(options.rows || [])];
  const confirmedCount = fullList.filter((row) => transferStatusClass(row.status) === "confirmed").length;
  const clubCount = new Set(fullList.map((row) => row.toTeam).filter(Boolean)).size;

  // Satır rozeti dürüstlük kuralına tabi: yalnızca ZATEN doğrulanmış
  // kayıtlar "TRANSFER" der, gerisi "RADAR" — henüz izleniyor demektir,
  // olmuş bitmiş değil.
  const sideRows = (options.rows || []).map((row) => {
    const rowStatusClass = transferStatusClass(row.status);
    const rowBadge = rowStatusClass === "confirmed" ? t("transfer.badge.transfer", locale) : t("transfer.badge.radar", locale);
    return `<a class="home-transfer-row" href="${escapeHtml(row.href)}">` +
      `<span class="home-transfer-row-badge status-${escapeHtml(rowStatusClass)}">${escapeHtml(rowBadge)}</span>` +
      `<strong>${escapeHtml(row.playerName)}</strong><b>${escapeHtml(row.toTeam)}</b></a>`;
  }).join("");

  // Kaynak bağlantısı, tam kart tıklanabilirliğinin ÜSTÜNDE kalması
  // gereken TEK öğe: kartın tamamı iç sayfaya (transfer-radari.html)
  // giderken, kaynağa gitmek isteyen okuyucu dış habere ayrı tıklamalı.
  // İki bağlantıyı iç içe geçirmek geçersiz HTML olurdu; çözüm CSS'te
  // (.home-transfer-feature-cover z-index altta, .detail-link üstte).
  const sourceAction = leader.sourceUrl
    ? `<a class="detail-link home-transfer-source-link" href="${escapeHtml(leader.sourceUrl)}" target="_blank" rel="nofollow noopener noreferrer">${escapeHtml(t("transfer.openDetail", locale))}</a>`
    : "";

  const allHref = options.allHref || (locale === "en" ? "/en/transfer-radar.html" : "/transfer-radari.html");
  const coverHref = `${allHref}${allHref.includes("?") ? "&" : "?"}team=${encodeURIComponent(leader.toTeam || "")}`;

  return `<article class="home-transfer-feature home-transfer-feature-big" data-card="home-transfer-watch" data-transfer-status="${escapeHtml(statusClass)}">` +
    `<div class="transfer-badge-row">` +
    (breaking ? `<span class="card-badge breaking">${escapeHtml(t("transfer.badge.breaking", locale))}</span>` : "") +
    `<span class="card-badge transfer">${escapeHtml(t("transfer.badge.transfer", locale))}</span>` +
    `<span class="status-badge status-${escapeHtml(statusClass)}">${escapeHtml(transferStatusLabel(leader.status, locale))}</span>` +
    `</div>` +
    `<div class="home-transfer-player"><div><span>${escapeHtml(t("transfer.latestConfirmed", locale))}</span><h3>${escapeHtml(leader.playerName)}</h3><p>${escapeHtml(leader.typeLabel || t("transfer.fallbackType", locale))} · ${escapeHtml(leader.date || "")}</p></div></div>` +
    `<div class="home-transfer-route"><b>${escapeHtml(leader.fromTeam || "—")}</b><em>→</em><b>${escapeHtml(leader.toTeam)}</b></div>` +
    `<p class="home-transfer-summary">${escapeHtml(transferSummarySentence(leader, locale))}</p>` +
    `<p class="home-transfer-take"><b>${escapeHtml(t("transfer.take.label", locale))}:</b> ${escapeHtml(transferTakeSentence(leader, locale))}</p>` +
    `<div class="home-transfer-meta-row">` +
    `<span class="home-transfer-source">${escapeHtml(t("transfer.source.label", locale))}: ${escapeHtml(leader.sourceName || t("transfer.source.unverified", locale))}</span>` +
    `</div>` +
    `<div class="home-transfer-actions">${sourceAction}${options.allHref ? `<a class="detail-link ghost" href="${escapeHtml(options.allHref)}">${escapeHtml(t("transfer.all", locale))}</a>` : ""}</div>` +
    `<a class="home-transfer-feature-cover" href="${escapeHtml(coverHref)}" aria-label="${escapeHtml(leader.playerName)} — ${escapeHtml(t("transfer.all", locale))}"></a>` +
    `</article><aside class="home-transfer-side" aria-label="${escapeHtml(t("transfer.recentAside.label", locale))}"><div class="home-transfer-metrics">` +
    compactMetricHtml(t("transfer.confirmedCount.label", locale), confirmedCount) +
    compactMetricHtml(t("transfer.clubCount.label", locale), clubCount) +
    compactMetricHtml(t("transfer.lastCheck.label", locale), leader.lastVerifiedAt || leader.date || t("fallback.general", locale)) +
    `</div><div class="home-transfer-list">${sideRows}</div></aside>`;
}

/**
 * SÜPER LİG BUGÜN ŞERİDİ — kompakt, yatay, yalnızca güncel Süper Lig
 * kulüplerinin bugünkü maçları, sabit bir öncelik sırasıyla.
 *
 * NEDEN AYRI BİR BİLEŞEN: ana sayfadaki genel "bugünün maçları" ızgarası
 * TÜM turnuvaları eşit ağırlıkta gösterir (kasıtlı — o bölüm dokunulmadı).
 * Bu şerit onun YERİNE değil, ÜSTÜNE eklenir: okuyucunun en çok aradığı
 * altı kulüp (ve ardından ligin geri kalanı) tek bakışta, logo+skorla.
 *
 * ÖNCELİK SIRASI editoryal bir karardır, veriden türetilmez — tıpkı
 * services/majorClubs.js'teki "büyük kulüp" listesi gibi. Sıralanan
 * kulüpler sabit ADLA eşleşir; sağlayıcı farklı bir yazım gönderirse o
 * kulüp yalnızca öncelik sırasını kaybeder, listeden düşmez (aşağıdaki
 * ikincil sıralama onu yine de gösterir).
 */
const SUPER_LIG_PRIORITY_NAMES = ["Galatasaray", "Fenerbahçe", "Beşiktaş", "Trabzonspor", "Samsunspor", "Başakşehir"];

/**
 * GÜNCEL SÜPER LİG KULÜPLERİ → arma listesi.
 *
 * `isCurrentSuperLigTeam` bayrağı tek kaynak (services/homePoll.js'teki
 * anket seçenekleriyle AYNI süzgeç): lig kadrosu değiştiğinde bu şerit de
 * kendiliğinden doğru kalır, elle güncellenen bir liste tutulmaz. Arma
 * yalnızca GERÇEK sayısal sağlayıcı kimliğinden türetilir; yoksa kulüp
 * listeden düşmez, yalnızca armasız (baş harfli) görünür.
 */
export function superLigTeamLogoMap(teams) {
  const list = [];
  for (const team of Array.isArray(teams) ? teams : []) {
    if (!team || !team.isCurrentSuperLigTeam || !team.name) continue;
    const providerId = String(team.providerId || "").trim();
    list.push({
      name: String(team.name),
      logo: /^\d+$/.test(providerId) ? `https://media.api-sports.io/football/teams/${providerId}.png` : ""
    });
  }
  return list;
}

/**
 * MAÇ VERİSİ İLE data/teams.json AYNI ADI FARKLI YAZABİLİR — tam ad eşitliği
 * yeterli değil ("Rizespor" vs "Çaykur Rizespor", "Gençlerbirliği" vs
 * "Gençlerbirliği S.K."). Eşleme `services/superLigTeams.js#sameClub` ile:
 * kadro senkronunun aynı ikizleşme sorununu çözmek için yazdığı, kelime
 * sınırlı içerme kuralı. İkinci bir eşleştirici yazmak, iki yerin farklı
 * kurallarla "aynı kulüp" demesi riskini taşırdı.
 */
function findSuperLigTeam(list, name) {
  return list.find((entry) => sameClub(entry.name, name)) || null;
}

function superLigPriorityRank(name) {
  const index = SUPER_LIG_PRIORITY_NAMES.findIndex((candidate) => sameClub(candidate, name));
  return index === -1 ? SUPER_LIG_PRIORITY_NAMES.length : index;
}

function teamLogoOrInitials(entry, name) {
  const logo = entry && entry.logo;
  if (logo) {
    return `<img class="superlig-strip-logo" src="${escapeHtml(logo)}" alt="" width="28" height="28" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex';" /><span class="superlig-strip-logo-fallback" aria-hidden="true" style="display:none">${escapeHtml(fixtureTeamInitials(name))}</span>`;
  }
  return `<span class="superlig-strip-logo-fallback" aria-hidden="true">${escapeHtml(fixtureTeamInitials(name))}</span>`;
}

/**
 * Durum: CANLI/MS/saat üçlüsü, genel maç kartlarıyla AYNI sözlükten
 * (services/matchStatus.js#canonicalStatus) — bu şeridin "Canlı" dediği
 * an, sitenin geri kalanının "Canlı" dediği anla birebir aynı olmalı.
 */
function superLigMatchState(match, locale) {
  const canonical = canonicalStatus(match && match.status);
  // "Süper Lig'de Bugün" şeridi canlılığı yalnızca duruma bakarak
  // belirliyordu: sağlayıcı bir maçı hiç "FINISHED"e çevirmezse şerit o
  // maçı günlerce "69'" diye gösteriyordu. Ortak kapı (gün + saat +
  // tazelik + skor) — services/matchStatus.js#liveVerdict.
  const isLive = LIVE_STATES.has(canonical) && isDisplayableLive(match);
  const isFinal = PLAYED_STATES.has(canonical) && match && match.score &&
    Number.isFinite(Number(match.score.home)) && Number.isFinite(Number(match.score.away));
  const minute = isLive && match && Number.isFinite(Number(match.minute)) ? `${Number(match.minute)}'` : "";
  if (isLive) return { isLive: true, isFinal: false, label: t("status.LIVE", locale), minute };
  if (isFinal) return { isLive: false, isFinal: true, label: t("card.fullTimeShort", locale), minute: "" };
  return { isLive: false, isFinal: false, label: match && match.time ? String(match.time) : t("card.scheduled", locale), minute: "" };
}

/**
 * Tek satır: [ev logosu+adı] [skor/saat] [deplasman logosu+adı], tamamı
 * tıklanabilir (transfer kartındaki aynı "kapak bağlantısı" deseni —
 * burada iç içe ikinci bir bağlantı yok, tüm satır tek `<a>`).
 */
function superLigMatchRowHtml(match, teamList, locale, hrefFor) {
  const home = findSuperLigTeam(teamList, match.homeTeam) || { name: match.homeTeam, logo: "" };
  const away = findSuperLigTeam(teamList, match.awayTeam) || { name: match.awayTeam, logo: "" };
  const state = superLigMatchState(match, locale);
  const score = state.isLive || state.isFinal
    ? `${escapeHtml(match.score && match.score.home !== undefined && match.score.home !== null ? match.score.home : "–")} - ${escapeHtml(match.score && match.score.away !== undefined && match.score.away !== null ? match.score.away : "–")}`
    : escapeHtml(state.label);
  const minuteHtml = state.isLive && state.minute ? ` <small class="superlig-strip-minute">${escapeHtml(state.minute)}</small>` : "";

  return `<a class="superlig-strip-row${state.isLive ? " is-live" : ""}" data-card="superlig-strip" data-match="${escapeHtml(match.id || "")}" href="${escapeHtml(hrefFor(match))}">` +
    `<span class="superlig-strip-team">${teamLogoOrInitials(home, home.name)}<b>${escapeHtml(home.name)}</b></span>` +
    `<span class="superlig-strip-score${state.isLive ? " is-live" : ""}">${state.isLive ? `<i class="live-pulse" aria-hidden="true"></i>` : ""}${score}${minuteHtml}</span>` +
    `<span class="superlig-strip-team is-away">${teamLogoOrInitials(away, away.name)}<b>${escapeHtml(away.name)}</b></span>` +
    `</a>`;
}

/**
 * Bugünün Süper Lig maçları, öncelik + saat sırasıyla.
 *
 * @param {object[]} matches  BUGÜNÜN maç havuzu (çağıran günü zaten süzmüş
 *   olmalı — bu fonksiyon "hangi gün" sorusuna karışmaz, yalnızca "hangi
 *   kulüp" sorusuna karışır).
 * @param {object[]} teams    data/teams.json
 * @param {string} locale
 * @param {object} options    { hrefFor(match) => string } — bağlantı kuralı
 *   dile göre değiştiği için (mac-detay.html / match-detail.html) çağırandan
 *   gelir, tıpkı fixtureCard'ın actionHref'i gibi.
 *
 * Süper Lig'de bugün maç yoksa BOŞ DİZE döner — bölüm hiç çizilmez. Boş bir
 * "bugün maç yok" kutusu göstermek, zaten altında duran genel program
 * bölümünün söylediğini tekrarlamak ve yer kaplamak olurdu.
 */
export function superLigTodayStripHtml(matches, teams, locale, options = {}) {
  const loc = normalizeLocale(locale);
  const teamList = superLigTeamLogoMap(teams);
  const hrefFor = typeof options.hrefFor === "function" ? options.hrefFor : () => "#";
  const cardFor = typeof options.cardFor === "function" ? options.cardFor : null;

  const scoped = (Array.isArray(matches) ? matches : []).filter((match) =>
    match && findSuperLigTeam(teamList, match.homeTeam) && findSuperLigTeam(teamList, match.awayTeam));

  // AYNI KARŞILAŞMA takvim kaynağında birden fazla kayıtla (farklı
  // kimlik/yazımla) görünebiliyor — bu bileşene özgü bir sorun değil,
  // İngilizce takvim beslemesinin kendi tuhaflığı. Genel "bugünün
  // maçları" ızgarasında bu fark az satır arasında kayboluyor; bu dar
  // şeritte "aynı maç iki kez" göze batardı. Anahtar EŞLENMİŞ (takma ad
  // çözülmüş) takım adlarından kurulur — "Rizespor" ile "Çaykur
  // Rizespor" aynı fikstürün iki kaydı sayılmalı.
  const seen = new Set();
  const todays = scoped.filter((match) => {
    const home = findSuperLigTeam(teamList, match.homeTeam);
    const away = findSuperLigTeam(teamList, match.awayTeam);
    const key = `${(home && home.name) || match.homeTeam}|${(away && away.name) || match.awayTeam}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!todays.length) return "";

  const sorted = todays.slice().sort((left, right) => {
    const leftRank = Math.min(superLigPriorityRank(left.homeTeam), superLigPriorityRank(left.awayTeam));
    const rightRank = Math.min(superLigPriorityRank(right.homeTeam), superLigPriorityRank(right.awayTeam));
    if (leftRank !== rightRank) return leftRank - rightRank;
    return String(left.kickoff || "").localeCompare(String(right.kickoff || ""));
  });

  // Ana sayfa, genel programla aynı fixture-card üreticisini verir. Geriye
  // dönük satır üreticisi yalnızca bu yardımcı başka bir yerde doğrudan
  // çağrılırsa kullanılmaya devam eder.
  const rows = sorted.map((match) => cardFor
    ? cardFor(match)
    : superLigMatchRowHtml(match, teamList, loc, hrefFor)).join("");

  // YALNIZCA İÇ İÇERİK döner — dıştaki kararlı kap (data-api-target,
  // data-static-fallback) index.html'de elle yazılı duruyor, tıpkı
  // .home-transfer-watch-shell gibi. Bu fonksiyon o kabın İÇİNİ, hem
  // ön-render hem istemci hidrasyonu için AYNI şekilde doldurur.
  // Derleme anı şeridin üstüne yazılır: statik HTML kendi kendini
  // düzeltemez çünkü içinde zaman yoktur. İstemci (site.js
  // neutralizeStaleLive) damgayı okur ve ömrü dolmuş "Canlı" rozetlerini
  // API'ye hiç bağlanmadan söker.
  return `<span class="superlig-strip-kicker">${escapeHtml(t("superlig.strip.kicker", loc))}</span>` +
    `<div class="${cardFor ? "matches-grid superlig-today-grid" : "superlig-strip-rail"}" data-live-rendered-at="${escapeHtml(new Date().toISOString())}">${rows}</div>`;
}
