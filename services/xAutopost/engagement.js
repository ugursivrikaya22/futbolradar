/**
 * X ETKİLEŞİM KATMANI — maç öncesi anket / "senin tahminin ne?" sorusu ve
 * maç sonu "Tahminini tutturan var mı?" takibi. Saf fonksiyonlar: ağ yok,
 * saat yok (`now` dışarıdan gelir), yeni veri kaynağı yok.
 *
 * BAYRAK: X_ENGAGEMENT_ENABLED=1 olmadıkça hiçbir aday üretilmez (varsayılan
 * KAPALI). Açıkken de gönderim X_AUTOPOST_ENABLED + kuru koşu kurallarına ve
 * X_MAX_PER_RUN / X_MAX_PER_DAY tavanlarına tabidir.
 * MALİYET: Anketli/soru gönderileri varsayılan BAĞLANTISIZ ($0.015);
 * X_ENGAGEMENT_LINKS=1 maç sayfası bağlantısını ekler ($0.20).
 */
const { weightedLength, MAX_WEIGHT, SITE } = require("./compose");

const PREMATCH_FROM_MS = 90 * 60e3; // başlamadan 90 dk önce
const PREMATCH_TO_MS = 60 * 60e3;   // ... 60 dk öncesine kadar
const POLL_MIN = 5;
const POLL_MAX = 10080;
const OPTION_MAX = 25;
const DRAW = "Beraberlik";

/** Döngüsel soru seti — maça göre deterministik seçilir. */
const QUESTIONS = [
  "Skor tahminin ne? Yorumlara yaz 👇",
  "İlk golü kim atar? Yorumlara yaz 👇",
  "Maçın adamı kim olur? Yorumlara yaz 👇",
  "Senin tahminin ne? Skoru yorumlara yaz 👇",
  "Bu maçta kaç gol çıkar? Tahminini yaz 👇"
];

const on = (v) => /^(1|true|yes|on)$/i.test(String(v || "").trim());
const off = (v) => /^(0|false|no|off)$/i.test(String(v || "").trim());

function engagementConfig(env = process.env) {
  return {
    enabled: on(env.X_ENGAGEMENT_ENABLED),
    // Anket varsayılan AÇIK (katman açıkken); X_ENGAGEMENT_POLLS=0 → yalnızca soru metni.
    polls: !off(env.X_ENGAGEMENT_POLLS),
    links: on(env.X_ENGAGEMENT_LINKS),
    followup: !off(env.X_ENGAGEMENT_FOLLOWUP)
  };
}

/** FNV-1a — aynı maç her koşuda aynı soruyu alır. */
function hash(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

function matchKey(m) {
  return m && m.providerIds && m.providerIds.apiFootball ? `af:${m.providerIds.apiFootball}` : String(m && m.id);
}

function pickQuestion(m) { return QUESTIONS[hash(matchKey(m)) % QUESTIONS.length]; }

/** Anket seçeneği: varsa kısa ad, 25 karakteri aşarsa sözcük sınırından kısaltılır. */
function shortName(name, short) {
  const pick = [short, name].map((v) => String(v || "").replace(/\s+/g, " ").trim()).find((v) => v && [...v].length <= OPTION_MAX);
  if (pick) return pick;
  const full = String(short || name || "").replace(/\s+/g, " ").trim();
  const words = full.split(" ");
  while (words.length > 1 && [...words.join(" ")].length > OPTION_MAX) words.pop();
  const w = words.join(" ");
  return [...w].length <= OPTION_MAX ? w : [...w].slice(0, OPTION_MAX).join("");
}

function pollOptions(m) {
  const home = shortName(m.homeTeam, m.homeTeamShort || m.homeShortName);
  const away = shortName(m.awayTeam, m.awayTeamShort || m.awayShortName);
  if (!home || !away || home === away) return null;
  return [home, DRAW, away];
}

/** Anket başlama anında kapanır; X sınırı 5–10080 dk. */
function pollDuration(now, kickoff) {
  const mins = Math.floor((Date.parse(kickoff) - new Date(now).getTime()) / 60e3);
  if (!Number.isFinite(mins)) return POLL_MIN;
  return Math.min(POLL_MAX, Math.max(POLL_MIN, mins));
}

function kickoffClock(kickoff) {
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(kickoff));
}

/**
 * Maç öncesi gönderi. `hasMedia`: X'te bir gönderi hem anket hem medya taşıyamaz;
 * medya varsa anket düşer, metin-soru varyantı kullanılır (tek gönderi, ek maliyet yok).
 */
function composePrematch(m, slug, { now = new Date(), polls = true, links = false, hasMedia = false } = {}) {
  if (!m || !m.homeTeam || !m.awayTeam) return null;
  const options = polls && !hasMedia ? pollOptions(m) : null;
  const question = pickQuestion(m);
  const head = `⏱️ MAÇ ÖNÜ${m.league ? ` | ${m.league}` : ""}\n${m.homeTeam} - ${m.awayTeam} · ${kickoffClock(m.kickoff)}`;
  const body = options ? `Kim kazanır? Ankete oy ver 🗳️\n${question}` : question;
  const url = links && slug ? `\n\n${SITE}/mac/${slug}` : "";
  let text = `${head}\n\n${body}${url}`;
  if (weightedLength(text) > MAX_WEIGHT) text = `${m.homeTeam} - ${m.awayTeam}\n\n${body}${url}`;
  if (weightedLength(text) > MAX_WEIGHT) return null;
  const item = { key: `prematch:${matchKey(m)}`, kind: "prematch", text, variant: options ? "poll" : "question" };
  if (options) item.poll = { options, duration_minutes: pollDuration(now, m.kickoff) };
  return item;
}

/** Maç sonu takip — yalnızca maç öncesi gönderisi paylaşılmış maçlar için (index.js). */
function composeFollowup(m, slug, { links = false } = {}) {
  const s = m && m.score;
  if (!s || !Number.isFinite(s.home) || !Number.isFinite(s.away)) return null;
  const url = links && slug ? `\n\n${SITE}/mac/${slug}` : "";
  const text = `🏁 ${m.homeTeam} ${s.home}-${s.away} ${m.awayTeam}\n\nTahminini tutturan var mı? 🎯 Yorumlara yaz 👇${url}`;
  if (weightedLength(text) > MAX_WEIGHT) return null;
  return { key: `followup:${matchKey(m)}`, kind: "followup", text, requires: `prematch:${matchKey(m)}` };
}

/** POST /2/tweets gövdesi. */
function tweetPayload(item) {
  const body = { text: item.text };
  if (item.poll) body.poll = { options: item.poll.options.slice(), duration_minutes: item.poll.duration_minutes };
  return body;
}

module.exports = {
  QUESTIONS, DRAW, OPTION_MAX, POLL_MIN, POLL_MAX, PREMATCH_FROM_MS, PREMATCH_TO_MS,
  engagementConfig, pickQuestion, shortName, pollOptions, pollDuration,
  composePrematch, composeFollowup, tweetPayload, matchKey
};
