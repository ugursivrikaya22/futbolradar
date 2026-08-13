/**
 * MAÇIN ADAMI ANKETİNİN TEK İŞARETLEME KAYNAĞI.
 *
 * Seçim buraya AİT DEĞİL: hangi maçta anket çıkacağı ve kimin oylanabileceği
 * services/motmPoll.js'te. Burası yalnızca "seçilmiş adaylar nasıl çizilir"
 * sorusunu cevaplar.
 *
 * BLOK `hidden` DOĞAR VE ONU İSTEMCİ AÇAR.
 *
 * Anket JavaScript olmadan çalışamaz — oy istemcide saklanıyor. JavaScript
 * kapalıyken görünen bir "Oy Ver" düğmesi, basıldığında hiçbir şey yapmayan
 * bir düğmedir; kullanıcıya olmayan bir söz vermek olurdu. Blok bu yüzden
 * `hidden` basılır ve yalnızca istemci önyüklendiğinde açılır.
 *
 * Yan faydası SEO'da: anket 300'den fazla sayfada tekrarlanan bir metin
 * bloğu. Tarayıcıya kapalı doğması, aynı başlık ve seçenek listesinin
 * sayfalar arası yinelenen içerik olarak görünmesini de engelliyor.
 * Blokta ayrıca JSON-LD YOK — anket bir içerik varlığı değil, bir
 * etkileşim; yapılandırılmış veri olarak bildirmek yanlış beyan olurdu.
 */

// Metinler TEK yerde: services/motmPoll.js. Buraya kopyalamak, gereksinimde
// birebir verilmiş cümlelerin iki dosyada ayrışması demek olurdu.
import { createRequire } from "node:module";

const { COPY } = createRequire(import.meta.url)("../../services/motmPoll.js");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Tek aday. Rol rozeti ("İlk 11" / "Oyuna girdi") okuyucuya adayın maça
 * NASIL katıldığını söyler — listede yalnızca oynayanlar olduğu için bu
 * rozet aynı zamanda listenin kanıtıdır.
 */
function optionRow(option, index, matchId) {
  const inputId = `motm-${matchId}-${option.id}`;
  const roleLabel = option.role === "substitute" ? COPY.substitute : COPY.starter;
  return `<li class="motm-poll__option">` +
    `<input class="motm-poll__radio" type="radio" name="motm-${escapeHtml(matchId)}" ` +
    `id="${escapeHtml(inputId)}" value="${escapeHtml(option.id)}"${index === 0 ? "" : ""}>` +
    `<label class="motm-poll__label" for="${escapeHtml(inputId)}">` +
    `<span class="motm-poll__name">${escapeHtml(option.name)}</span>` +
    (option.team ? `<span class="motm-poll__team">${escapeHtml(option.team)}</span>` : "") +
    `<span class="motm-poll__role is-${escapeHtml(option.role)}">${escapeHtml(roleLabel)}</span>` +
    `</label></li>`;
}

/**
 * Anket bloğu. `poll` yoksa BOŞ DÖNER — eksik veri yer tutucuyla
 * doldurulmaz, anket hiç basılmaz.
 */
export function motmPollBlock(poll) {
  if (!poll || !Array.isArray(poll.options) || poll.options.length < 2) return "";

  const matchId = poll.matchId;
  const options = poll.options.map((option, index) => optionRow(option, index, matchId)).join("");
  const heading = `motm-title-${matchId}`;

  return `<section class="motm-poll" data-motm-poll data-motm-match="${escapeHtml(matchId)}" ` +
    `aria-labelledby="${escapeHtml(heading)}" hidden>
      <div class="motm-poll__badge" aria-hidden="true">⭐ ${escapeHtml(COPY.badge)}</div>
      <h2 class="motm-poll__title" id="${escapeHtml(heading)}">${escapeHtml(COPY.title)}</h2>
      <p class="motm-poll__subtitle">${escapeHtml(COPY.subtitle)}</p>
      <form class="motm-poll__form" data-motm-form>
        <ul class="motm-poll__options">${options}</ul>
        <button class="motm-poll__submit" type="submit" data-motm-submit>${escapeHtml(COPY.button)}</button>
      </form>
      <p class="motm-poll__thanks" data-motm-thanks hidden>${escapeHtml(COPY.thanks)}</p>
      <div class="motm-poll__results" data-motm-results hidden></div>
      <p class="motm-poll__note" data-motm-note hidden>${escapeHtml(COPY.localNote)}</p>
    </section>`;
}

export { COPY as MOTM_COPY };
