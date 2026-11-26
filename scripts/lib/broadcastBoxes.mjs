/**
 * YAYIN KUTULARI — "Bugün Hangi Maç Hangi Kanalda" sayfası ve ana sayfa kutusu.
 * ----------------------------------------------------------------------------
 * İki yüzey de AYNI maç listesinden (services/broadcastSchedule.js#
 * selectBroadcastMatches) ve AYNI kanal kuralından (broadcastChannels /
 * broadcastLabel) beslenir. Burada yeni veri ya da kanal üretilmez:
 *   - kanal adı yalnızca maç düzeyinde doğrulanmış kayıttan gelir (TRT 1,
 *     TRT Spor, beIN Sports 1 … akıştaki yazımıyla);
 *   - doğrulanmamışsa "Yayın bilgisi bekleniyor" yazılır, kanal tahmin edilmez;
 *   - YAYIN BAĞLANTISI YOKTUR: yalnızca kanal adı. Gömülü oynatıcı, canlı
 *     yayın adresi ya da lisanssız akış bu modülden çıkmaz.
 *
 * Saf fonksiyonlar (dosya/ağ yok): üretici, ön işleyici ve test aynı kodu çağırır.
 */
import { createRequire } from "node:module";
import { escapeHtml } from "./matchCards.mjs";

const require = createRequire(import.meta.url);
const { broadcastChannels, broadcastLabel, competitionDisplayName } = require("../../services/broadcastSchedule.js");
const { matchDetailPath } = require("../../services/matchProgram.js");

const PENDING_KEY = "__pending__";

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

/** Başlama saati "HH:MM" (Europe/Istanbul); saat yoksa boş dize. */
export function kickoffTime(match) {
  const explicit = text(match && match.time);
  if (/^\d{1,2}:\d{2}$/.test(explicit)) return explicit.padStart(5, "0");
  const parsed = new Date(text(match && match.kickoff));
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hour12: false }).format(parsed);
}

/** Kanal adı → o kanaldaki maçlar. Kanalı doğrulanmamış maçlar ayrı grupta. */
export function groupByChannel(matches) {
  const groups = new Map();
  const add = (key, label, match) => {
    if (!groups.has(key)) groups.set(key, { key, label, pending: key === PENDING_KEY, matches: [] });
    groups.get(key).matches.push(match);
  };
  for (const match of Array.isArray(matches) ? matches : []) {
    const channels = broadcastChannels(match);
    if (!channels.length) add(PENDING_KEY, "Kanal bilgisi bekleniyor", match);
    // Aynı yayının iki beslemesi (ör. beIN SPORTS 1 + 4K) iki grupta da görünür.
    else for (const channel of channels) add(channel, channel, match);
  }
  // Doğrulanmış kanallar önce (ada göre, TRT kanalları dahil Türkçe sıralama),
  // bekleyenler sonda.
  return [...groups.values()].sort((a, b) => Number(a.pending) - Number(b.pending) || a.label.localeCompare(b.label, "tr"));
}

function matchLine(match) {
  const time = kickoffTime(match);
  return `<li><span class="broadcast-channel-time">${escapeHtml(time || "Saat bekleniyor")}</span> ${escapeHtml(text(match.homeTeam))} – ${escapeHtml(text(match.awayTeam))} <small>${escapeHtml(competitionDisplayName(match))}</small></li>`;
}

/**
 * Sayfadaki "Kanala göre" özeti: her kanal bir blok, altında o kanalın günün
 * maçları. Okuyucunun asıl sorusu ("TRT 1'de ne var?") kart ızgarasında
 * aranmadan cevaplanır. Maç yoksa boş dize (sayfa zaten boş gün kutusu basar).
 */
export function channelSummaryHtml(matches) {
  const groups = groupByChannel(matches);
  if (!groups.length) return "";
  const blocks = groups.map((group) => `<li class="broadcast-channel${group.pending ? " is-pending" : ""}" data-channel="${escapeHtml(group.pending ? "pending" : group.label)}">
      <h3><span class="broadcast-channel-icon" aria-hidden="true">📺</span>${escapeHtml(group.label)} <small>${group.matches.length} maç</small></h3>
      <ul>${group.matches.map(matchLine).join("")}</ul>
    </li>`).join("\n    ");
  return `<section class="broadcast-channel-summary" aria-labelledby="broadcast-channel-title">
  <h2 id="broadcast-channel-title">Kanala göre bugünün maçları</h2>
  <ul class="broadcast-channel-list">
    ${blocks}
  </ul>
</section>`;
}

/**
 * Ana sayfa "Bugünün Maç Yayınları" kutusunun GÖVDESİ (başlık sayfada sabit).
 * En fazla `limit` maç; fazlası için sayfa bağlantısı zaten var. Maç satırı
 * yalnızca saat, takımlar, lig ve kanal adıdır — yayın bağlantısı yok.
 */
export function homeBroadcastBoxHtml(matches, { limit = 6 } = {}) {
  const list = Array.isArray(matches) ? matches : [];
  if (!list.length) {
    return `<p class="broadcast-box-empty">Bugün öncelikli liglerde ve Türk takımlarında maç bulunmuyor.</p>`;
  }
  const rows = list.slice(0, limit).map((match) => {
    const label = broadcastLabel(match, "tr");
    const pending = label.state !== "verified";
    const channel = pending ? label.text : label.channel;
    return `<li class="broadcast-box-row" data-broadcast="${pending ? "pending" : "verified"}">
        <span class="broadcast-box-time">${escapeHtml(kickoffTime(match) || "—")}</span>
        <span class="broadcast-box-match"><a href="${escapeHtml("./" + String(matchDetailPath(match)).replace(/^\.?\//, ""))}">${escapeHtml(text(match.homeTeam))} – ${escapeHtml(text(match.awayTeam))}</a><small>${escapeHtml(competitionDisplayName(match))}</small></span>
        <span class="broadcast-box-channel${pending ? " is-unknown" : ""}"><span aria-hidden="true">📺</span> ${escapeHtml(channel)}</span>
      </li>`;
  }).join("\n      ");
  const more = list.length > limit ? `<p class="broadcast-box-more">+${list.length - limit} maç daha — tamamı yayın sayfasında.</p>` : "";
  return `<ul class="broadcast-box-list">
      ${rows}
    </ul>${more}`;
}
