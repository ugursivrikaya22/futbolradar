/**
 * X OTOMATİK PAYLAŞIM — TWEET METİNLERİ (saf fonksiyonlar; ağ/saat yok).
 *
 * KURAL: Hiçbir metin uydurma veri içermez. Analiz cümlesi yalnızca maçın
 * kendi skoru ve sağlayıcı istatistiklerinden (xG, topla oynama, isabetli
 * şut) KURALLA türetilir; köşe yazısı metni yazının kendi spot/özetinden
 * gelir. LLM yok, ek API isteği yok.
 */
const notificationCore = require("../../match-notifications-core.js");

const SITE = "https://www.futbolradar.com";
const MAX_WEIGHT = 280;
const URL_WEIGHT = 23; // X t.co: her bağlantı 23 karakter sayılır

/* ---------------------------- uzunluk ------------------------------ */

// twitter-text v3 ağırlıkları: bu aralıklar 1, geri kalanı (CJK, emoji) 2.
const LIGHT = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]];
const URL_RE = /https?:\/\/[^\s]+/g;

function weightedLength(text) {
  let total = 0;
  const withoutUrls = String(text).replace(URL_RE, () => { total += URL_WEIGHT; return ""; });
  for (const ch of withoutUrls) {
    const cp = ch.codePointAt(0);
    if (cp === 0xfe0f || cp === 0x200d) continue; // emoji seçicileri/birleştiricileri ayrıca sayılmaz
    total += LIGHT.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2;
  }
  return total;
}

/** Metni, `build(kısaltılmış)` sonucu 280'e sığana dek sözcük sınırından kısaltır. */
function fitText(build, text) {
  let value = String(text || "").replace(/\s+/g, " ").trim();
  if (weightedLength(build(value)) <= MAX_WEIGHT) return build(value);
  const words = value.split(" ");
  while (words.length > 1) {
    words.pop();
    const candidate = words.join(" ").replace(/[\s,;:.–-]+$/, "") + "…";
    if (weightedLength(build(candidate)) <= MAX_WEIGHT) return build(candidate);
  }
  return build("").replace(/\n{3,}/g, "\n\n");
}

/* ---------------------------- yardımcılar --------------------------- */

function scoreOf(m) {
  const s = m && m.score;
  return s && Number.isFinite(s.home) && Number.isFinite(s.away) ? { home: s.home, away: s.away } : null;
}

function stat(m, type) {
  const row = (Array.isArray(m.statistics) ? m.statistics : []).find((s) => s && s.type === type);
  if (!row || !Number.isFinite(Number(row.home)) || !Number.isFinite(Number(row.away))) return null;
  return { home: Number(row.home), away: Number(row.away) };
}

function fmt(n) { return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(".", ","); }

function matchUrl(slug) { return `${SITE}/mac/${slug}`; }

// Türkçe ad ekleri (-ın/-in) kullanılmaz: takım adına ek uydurma riski yok.

/**
 * BİR CÜMLELİK ANALİZ — deterministik kural zinciri.
 * Sıra: xG ters köşesi → düşük topla oynamaya rağmen galibiyet → farklı
 * galibiyet → isabetli şut üstünlüğü → beraberlik dengesi → yalın sonuç.
 */
function analysisSentence(m) {
  const sc = scoreOf(m);
  if (!sc) return null;
  const xg = stat(m, "Gol beklentisi (xG)");
  const pos = stat(m, "Topla oynama");
  const sot = stat(m, "İsabetli şut");
  const total = stat(m, "Toplam şut");
  if (sc.home === sc.away) {
    if (xg && Math.abs(xg.home - xg.away) >= 0.5) {
      const side = xg.home > xg.away ? "home" : "away";
      const team = side === "home" ? m.homeTeam : m.awayTeam;
      return `xG'de ${team} ${fmt(xg[side])}-${fmt(xg[side === "home" ? "away" : "home"])} önde olsa da puanlar paylaşıldı.`;
    }
    if (sot) return `İsabetli şutta ${sot.home}-${sot.away} biten dengeli maçta puanlar paylaşıldı.`;
    const lastDraw = goalEvents(m).pop();
    if (lastDraw && lastDraw.playerName && lastDraw.minute != null && sc.home > 0) return `Eşitliği getiren son golü ${lastDraw.minute}. dakikada ${lastDraw.playerName} kaydetti.`;
    return sc.home === 0 ? "Gol sesinin çıkmadığı maçta puanlar paylaşıldı." : `${sc.home}-${sc.away} biten maçta puanlar paylaşıldı.`;
  }
  const w = sc.home > sc.away ? "home" : "away";
  const l = w === "home" ? "away" : "home";
  const W = w === "home" ? m.homeTeam : m.awayTeam;
  const margin = Math.abs(sc.home - sc.away);
  if (xg && xg[w] + 0.3 < xg[l]) return `${W}, xG'de ${fmt(xg[w])}-${fmt(xg[l])} geride kalmasına rağmen 3 puanı aldı.`;
  if (pos && pos[w] <= 42) return `${W}, topla oynamada %${pos[w]} ile geride kalmasına rağmen kazanmayı bildi.`;
  if (margin >= 3 && sot) return `${W}, ${sot[w]} isabetli şutla rakibine ${margin} farklı net bir galibiyet aldı.`;
  if (sot && sot[w] > sot[l]) return `${W}, isabetli şutta ${sot[w]}-${sot[l]} üstünlük kurarak kazandı.`;
  if (total && total[w] < total[l]) return `${W}, şut sayısında ${total[w]}-${total[l]} geride kalsa da farkı skora yansıttı.`;
  const last = goalEvents(m).pop();
  if (last && last.playerName && last.minute != null) return `Maçın son golünü ${String(last.minute).replace(/\+/, "+")}. dakikada ${last.playerName} kaydetti.`;
  return `${W}, sahadan ${Math.max(sc.home, sc.away)}-${Math.min(sc.home, sc.away)} galip ayrıldı.`;
}

/* ---------------------------- tweet türleri ------------------------- */

function composeResult(m, slug) {
  const sc = scoreOf(m);
  if (!sc || !slug) return null;
  const head = `🏁 MAÇ SONU${m.league ? ` | ${m.league}` : ""}\n${m.homeTeam} ${sc.home}-${sc.away} ${m.awayTeam}`;
  const url = matchUrl(slug);
  const text = fitText((a) => (a ? `${head}\n\n${a}\n\n${url}` : `${head}\n\n${url}`), analysisSentence(m) || "");
  return { key: `result:${m.providerIds && m.providerIds.apiFootball ? `af:${m.providerIds.apiFootball}` : m.id}`, kind: "result", text };
}

/** Favori takım golleri — olay kimlikleri web push çekirdeğiyle AYNI (match-notifications-core.js#events). */
function goalEvents(m) {
  const out = [];
  for (const raw of Array.isArray(m.events) ? m.events : []) {
    const [e] = notificationCore.events({ id: m.id, events: [raw] });
    if (!e || (e.type !== "goal" && e.type !== "penalty_scored")) continue;
    // Sağlayıcı dökümünde oyuncu adı `value` içinde gelir ("Ad · Asist: … · Normal Goal").
    out.push({ ...e, playerName: e.playerName || String(raw.value || "").split("·")[0].trim() });
  }
  return out;
}

function scorerName(raw) {
  return String(raw || "").split("·")[0].trim();
}

function composeGoal(m, event, slug, { isLatest }) {
  if (!slug) return null;
  const sc = scoreOf(m);
  const player = scorerName(event.playerName) || null;
  const minute = event.minute != null ? `${event.minute}${event.extraMinute ? `+${event.extraMinute}` : ""}'` : "";
  const lines = [`⚽ GOL! ${event.teamName || ""}`.trim()];
  // Skor yalnızca SON gol için yazılır: daha eski bir golün anındaki skoru
  // sağlayıcı vermiyor, tahmin edip yazmayız.
  lines.push(`${m.homeTeam} ${isLatest && sc ? `${sc.home}-${sc.away}` : "-"} ${m.awayTeam}`);
  const detail = [player, minute, event.type === "penalty_scored" ? "(penaltı)" : ""].filter(Boolean).join(" ");
  if (detail) lines.push(detail);
  const text = `${lines.join("\n")}\n\n${matchUrl(slug)}`;
  return { key: `goal:${event.id}`, kind: "goal", text: weightedLength(text) <= MAX_WEIGHT ? text : `${lines[0]}\n${lines[1]}\n\n${matchUrl(slug)}` };
}

function composeColumn(col) {
  if (!col || !col.slug || !col.title) return null;
  const url = `${SITE}/kose-yazilari/${col.slug}`;
  const head = `✍️ Köşe Yazısı: ${col.title}`;
  const summary = col.spot || col.excerpt || col.metaDescription || "";
  let text = fitText((s) => (s ? `${head}\n\n${s}\n\n${url}` : `${head}\n\n${url}`), summary);
  if (weightedLength(text) > MAX_WEIGHT) text = fitText((t) => `✍️ ${t}\n\n${url}`, col.title);
  return { key: `column:${col.slug}`, kind: "column", text };
}

function composeTransferDigest(transfers, dateKey) {
  const list = transfers.slice(0, 3);
  if (!list.length) return null;
  const url = `${SITE}/super-lig-transferleri-2026-2027.html`;
  const lines = list.map((t) => `• ${t.playerName}: ${t.fromTeam} → ${t.toTeam}${t.type ? ` (${t.type})` : ""}`);
  let body = lines.slice();
  let text;
  do { text = `🔁 Transfer özeti\n${body.join("\n")}\n\n${url}`; } while (weightedLength(text) > MAX_WEIGHT && body.pop());
  return { key: `filler:transfers:${list.map((t) => t.id).join(",")}`, kind: "filler", text, dateKey };
}

function composeLeaderStat(leaders, which) {
  const list = (leaders && Array.isArray(leaders[which]) ? leaders[which] : []).slice(0, 3);
  if (!list.length) return null;
  const metric = which === "topScorers" ? "goals" : "assists";
  const label = which === "topScorers" ? "gol" : "asist";
  const title = which === "topScorers" ? "⚽ Süper Lig gol krallığı" : "🎯 Süper Lig asist krallığı";
  const url = which === "topScorers" ? `${SITE}/gol-kralligi.html` : `${SITE}/asist-kralligi.html`;
  const rows = list.map((p, i) => `${i + 1}. ${p.name} (${p.team}) – ${p[metric]} ${label}`);
  const text = `${title}\n${rows.join("\n")}\n\n${url}`;
  return { key: `filler:${which}:${list.map((p) => `${p.providerId || p.name}=${p[metric]}`).join(",")}`, kind: "filler", text: weightedLength(text) <= MAX_WEIGHT ? text : `${title}\n${rows[0]}\n\n${url}` };
}

/* ------------------------- maç öncesi (etkileşim) ------------------- */

const POLL_OPTION_MAX = 25; // X: 2-4 seçenek, her biri 1-25 karakter

function pollOption(name) {
  const v = String(name || "").replace(/\s+/g, " ").trim();
  return [...v].length <= POLL_OPTION_MAX ? v : [...v].slice(0, POLL_OPTION_MAX - 1).join("").trim() + "…";
}

/** İstanbul saatiyle "Bugün 20:00" / "Yarın 13:30" / "1 Kasım 20:00". */
function kickoffLabel(kickIso, now) {
  const fmt = (d, o) => new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", ...o }).format(d);
  const kick = new Date(kickIso);
  const day = (d) => fmt(d, { year: "numeric", month: "2-digit", day: "2-digit" });
  const time = fmt(kick, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  if (day(kick) === day(now)) return `Bugün ${time}`;
  if (day(kick) === day(new Date(now.getTime() + 864e5))) return `Yarın ${time}`;
  return `${fmt(kick, { day: "numeric", month: "long" })} ${time}`;
}

function matchIdOf(m) {
  return m.providerIds && m.providerIds.apiFootball ? `af:${m.providerIds.apiFootball}` : String(m.id);
}

/**
 * Maç öncesi X anketi: ev sahibi / beraberlik / deplasman. Anket süresi
 * başlama saatinde biter (5 dk – 7 gün aralığına kısılır). Oy sayısı hiçbir
 * metinde yazılmaz; X sonuçları zaten yüzde gösterir.
 */
function composePrematchPoll(m, slug, { now = new Date() } = {}) {
  if (!slug || !m.homeTeam || !m.awayTeam) return null;
  const kick = Date.parse(m.kickoff);
  if (!Number.isFinite(kick)) return null;
  const options = [pollOption(m.homeTeam), "Beraberlik", pollOption(m.awayTeam)];
  if (new Set(options).size !== 3 || options.some((o) => !o)) return null;
  const minutes = Math.max(5, Math.min(10080, Math.floor((kick - now.getTime()) / 60000)));
  const head = `📊 MAÇ ÖNCESİ ANKET${m.league ? ` | ${m.league}` : ""}\n${m.homeTeam} – ${m.awayTeam}\n⏰ ${kickoffLabel(m.kickoff, now)}`;
  const text = `${head}\n\nSenin tahminin ne? Kim kazanır?\n\n${matchUrl(slug)}`;
  return { key: `prematch-poll:${matchIdOf(m)}`, kind: "prematch-poll", text: weightedLength(text) <= MAX_WEIGHT ? text : `📊 ${m.homeTeam} – ${m.awayTeam}\nKim kazanır?\n\n${matchUrl(slug)}`, poll: { options, duration_minutes: minutes } };
}

/** "Senin tahminin ne?" — skor tahmini yanıtlarda istenir (anketsiz düz gönderi). */
function composePrematchAsk(m, slug, { now = new Date() } = {}) {
  if (!slug || !m.homeTeam || !m.awayTeam || !Number.isFinite(Date.parse(m.kickoff))) return null;
  const head = `🔮 Senin tahminin ne?\n${m.homeTeam} – ${m.awayTeam}${m.league ? ` (${m.league})` : ""}\n⏰ ${kickoffLabel(m.kickoff, now)}`;
  const text = `${head}\n\nSkor tahminini yanıtlara yaz 👇\n\n${matchUrl(slug)}`;
  return { key: `prematch-ask:${matchIdOf(m)}`, kind: "prematch-ask", text: weightedLength(text) <= MAX_WEIGHT ? text : `🔮 ${m.homeTeam} – ${m.awayTeam}\nSkor tahminin ne? 👇\n\n${matchUrl(slug)}` };
}

module.exports = {
  SITE, MAX_WEIGHT, weightedLength, fitText, analysisSentence, goalEvents,
  composeResult, composeGoal, composeColumn, composeTransferDigest, composeLeaderStat,
  composePrematchPoll, composePrematchAsk, kickoffLabel, pollOption, POLL_OPTION_MAX
};
