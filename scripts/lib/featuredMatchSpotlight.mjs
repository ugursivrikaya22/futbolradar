/**
 * ANA SAYFA MAÇ VİTRİNİ — İŞARETLEME (TEK KAYNAK).
 *
 * Türkçe ve İngilizce ana sayfa, takım sayfası ve lig sayfası aynı
 * üreticiden geçer; iki dilde iki ayrı şablon tutmak birinin diğerinden
 * sessizce ayrılmasıyla biter (aynı gerekçe `scripts/lib/homePoll.mjs` ve
 * `scripts/lib/matchSpecialPromo.mjs` başında da yazılı).
 *
 * KUTUDA UYDURMA BİLGİ YOK. Skor yalnızca sağlayıcı okunabilir bir skor
 * bildirdiğinde yazılır; stat, hakem ve yayın satırları veri yoksa hiç
 * basılmaz. "Muhtemel 11" ibaresi resmî kadro açıklanana kadar korunur ve
 * resmî 11 geldiğinde metin kendiliğinden değişir.
 *
 * BAŞLIKLAR ARAMA NİYETİNE GÖRE DEĞİŞİR, ADRES DEĞİŞMEZ. Maç öncesi
 * "ne zaman / saat kaçta", maç sırasında "canlı skor / kaç kaç", maç
 * sonrasında "maç sonucu" okuyucunun o an aradığı şeydir. Kutunun
 * bağlandığı `/mac/<slug>` adresi her üç evrede de aynı kalır.
 */

const PHASE_ANCHORS = ["muhtemel-11", "olaylar", "istatistik", "puan-durumu"];

const STRINGS = {
  tr: {
    aria: "Öne çıkan maç",
    badge: { pre: "MAÇ ÖNÜ", "in-progress": "BAŞLIYOR", live: "CANLI", post: "MAÇ SONUCU", postponed: "ERTELENDİ" },
    cta: { pre: "Muhtemel 11, saat ve yayın bilgisi", "in-progress": "Canlı skoru aç", live: "Canlı skor ve maç anlatımı", post: "Maç sonucu, goller ve istatistikler", postponed: "Maç sayfasını aç" },
    links: [
      { anchor: "muhtemel-11", label: "İlk 11 ve kadrolar" },
      { anchor: "olaylar", label: "Goller ve maç olayları" },
      { anchor: "istatistik", label: "Maç istatistikleri" },
      { anchor: "puan-durumu", label: "Puan durumu" }
    ],
    facts: { time: "Saat", venue: "Stadyum", referee: "Hakem", channel: "Yayın", competition: "Turnuva" },
    tsi: "TSİ",
    today: "bugün",
    tomorrow: "yarın",
    minuteSuffix: "'",
    title: {
      pre: (home, away, when) => `${home} - ${away} maçı ${when}`,
      "in-progress": (home, away) => `${home} - ${away} maçı başladı`,
      live: (home, away, score) => `${home} ${score} ${away} · canlı skor`,
      post: (home, away, score) => `${home} ${score} ${away} maç sonucu`,
      postponed: (home, away) => `${home} - ${away} maçı ertelendi`
    },
    lead: {
      pre: "Muhtemel 11'ler, stadyum, hakem ve yayın bilgisi maç sayfasında. Kesin kadrolar açıklandığında ilk 11'ler otomatik olarak yerini alır.",
      "in-progress": "Maç başladı. Skor, dakika ve maç olayları doğrulanmış kaynaktan geldiği anda maç sayfasında açılır.",
      live: "Goller, asistler, kartlar, oyuncu değişiklikleri ve maç istatistikleri maç sayfasında anlık güncelleniyor.",
      post: "Goller, asistler, kartlar, oyuncu değişiklikleri, maç istatistikleri ve puan durumu maç sayfasında kalıcı olarak yayında.",
      postponed: "Karşılaşma ertelendi. Yeni tarih doğrulandığında aynı maç sayfası güncellenir."
    }
  },
  en: {
    aria: "Featured match",
    badge: { pre: "PREVIEW", "in-progress": "KICK-OFF", live: "LIVE", post: "FULL TIME", postponed: "POSTPONED" },
    cta: { pre: "Line-ups, kick-off time and TV", "in-progress": "Open the live score", live: "Live score and commentary", post: "Result, goals and statistics", postponed: "Open the match page" },
    links: [
      { anchor: "muhtemel-11", label: "Line-ups and squads" },
      { anchor: "olaylar", label: "Goals and match events" },
      { anchor: "istatistik", label: "Match statistics" },
      { anchor: "puan-durumu", label: "Standings" }
    ],
    facts: { time: "Kick-off", venue: "Stadium", referee: "Referee", channel: "TV", competition: "Competition" },
    tsi: "(UTC+3)",
    today: "today",
    tomorrow: "tomorrow",
    minuteSuffix: "'",
    title: {
      pre: (home, away, when) => `${home} vs ${away} ${when}`,
      "in-progress": (home, away) => `${home} vs ${away} has kicked off`,
      live: (home, away, score) => `${home} ${score} ${away} · live score`,
      post: (home, away, score) => `${home} ${score} ${away} result`,
      postponed: (home, away) => `${home} vs ${away} postponed`
    },
    lead: {
      pre: "Probable line-ups, stadium, referee and broadcast details are on the match page. Confirmed starting XIs replace the predicted ones automatically.",
      "in-progress": "The match has started. Score, minute and events appear on the match page as soon as a verified source reports them.",
      live: "Goals, assists, cards, substitutions and match statistics update live on the match page.",
      post: "Goals, assists, cards, substitutions, statistics and standings stay published on the match page.",
      postponed: "The fixture was postponed. The same match page updates once a new date is verified."
    }
  }
};

const MONTHS_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const DAYS_TR = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/**
 * Saat ve gün, ISO damgasının KENDİ saat diliminden okunur (…T22:00:00+03:00).
 * Yeniden hesaplamak derleme makinesinin saat dilimine bağlı olurdu ve
 * Vercel'de UTC'ye kayardı — aynı tuzak `matchSpecialPromo.mjs` içinde de not
 * edilmiş.
 */
export function kickoffParts(kickoff) {
  const raw = String(kickoff || "");
  const time = /T(\d{2}:\d{2})/.exec(raw);
  const day = raw.slice(0, 10);
  return { time: time ? time[1] : "", day };
}

/** "17 Eylül Perşembe" / "Thursday, 17 September". */
function formatDay(dayIso, locale) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayIso)) return "";
  const [year, month, date] = dayIso.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
  if (locale === "en") {
    const monthName = new Date(Date.UTC(year, month - 1, date)).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
    const dayName = new Date(Date.UTC(year, month - 1, date)).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
    return `${dayName}, ${date} ${monthName}`;
  }
  return `${date} ${MONTHS_TR[month - 1]} ${DAYS_TR[weekday]}`;
}

/** Bugün / yarın / tarih — okuyucunun aradığı "maçı bugün mü?" sorusu. */
export function whenPhrase({ kickoff, locale, nowIstanbulDay }) {
  const copy = STRINGS[locale === "en" ? "en" : "tr"];
  const { time, day } = kickoffParts(kickoff);
  if (!time) return formatDay(day, locale);

  const tomorrow = nextDay(nowIstanbulDay);
  const clock = `${time} ${copy.tsi}`;

  if (day && day === nowIstanbulDay) {
    return locale === "en" ? `${copy.today} at ${clock}` : `${copy.today} saat ${clock}'de`;
  }
  if (day && day === tomorrow) {
    return locale === "en" ? `${copy.tomorrow} at ${clock}` : `${copy.tomorrow} saat ${clock}'de`;
  }
  const dayText = formatDay(day, locale);
  return locale === "en" ? `${dayText} at ${clock}` : `${dayText} saat ${clock}'de`;
}

function nextDay(dayIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayIso || ""))) return "";
  const stamp = Date.parse(`${dayIso}T12:00:00Z`);
  return new Date(stamp + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Okunabilir skor var mı? Yoksa skor satırı hiç basılmaz. */
function scoreText(entry) {
  const score = entry && entry.score;
  if (!score) return "";
  const home = score.home;
  const away = score.away;
  if (home === null || home === undefined || away === null || away === undefined) return "";
  if (!Number.isFinite(Number(home)) || !Number.isFinite(Number(away))) return "";
  return `${Number(home)}-${Number(away)}`;
}

/** Vitrin başlığı; evreye göre arama niyetine oturur. */
export function spotlightTitle(view, locale) {
  const copy = STRINGS[locale === "en" ? "en" : "tr"];
  const home = view.homeTeam;
  const away = view.awayTeam;
  const score = scoreText(view);

  if (view.phase === "live" && score) return copy.title.live(home, away, score);
  if (view.phase === "post" && score) return copy.title.post(home, away, score);
  if (view.phase === "post") return copy.title["in-progress"](home, away);
  if (view.phase === "postponed") return copy.title.postponed(home, away);
  if (view.phase === "live" || view.phase === "in-progress") return copy.title["in-progress"](home, away);
  return copy.title.pre(home, away, whenPhrase({ kickoff: view.kickoff, locale, nowIstanbulDay: view.todayIstanbul }));
}

function factRow(label, value) {
  if (!value) return "";
  return `<div class="fms__fact"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

/**
 * Ana sayfa vitrini. `href` üreticiden GELİR, burada slug kurulmaz: adresi
 * gerçekten yazan üretici `data/match-seo-pages.json` kaydını tutuyor ve
 * burada ikinci bir slug kuralı yazmak, üretici adresi değiştirdiğinde ana
 * sayfayı 404'e bağlamak olurdu.
 */
export function spotlightBlock(view, options) {
  const locale = options && options.locale === "en" ? "en" : "tr";
  const copy = STRINGS[locale];
  if (!view || !view.href || !view.homeTeam || !view.awayTeam) return "";

  const phase = copy.badge[view.phase] ? view.phase : "pre";
  const title = spotlightTitle({ ...view, phase }, locale);
  const score = scoreText(view);
  const minute = view.minute ? `${view.minute}${copy.minuteSuffix}` : "";
  const { time } = kickoffParts(view.kickoff);

  const facts = [
    factRow(copy.facts.competition, view.league),
    factRow(copy.facts.time, time ? `${time} ${copy.tsi}` : ""),
    factRow(copy.facts.venue, view.venue),
    factRow(copy.facts.referee, view.referee),
    factRow(copy.facts.channel, view.broadcast)
  ].filter(Boolean).join("");

  const links = copy.links
    .filter((link) => PHASE_ANCHORS.includes(link.anchor))
    .map((link) => `<a class="fms__jump" href="${escapeHtml(view.href)}#${link.anchor}">${escapeHtml(link.label)}</a>`)
    .join("");

  const scoreBoard = score
    ? `<div class="fms__score" data-fms-score><span class="fms__score-value">${escapeHtml(score)}</span>${minute ? `<span class="fms__minute" data-fms-minute>${escapeHtml(minute)}</span>` : ""}</div>`
    : `<div class="fms__score is-empty" data-fms-score hidden><span class="fms__score-value"></span><span class="fms__minute" data-fms-minute></span></div>`;

  // `data-fms-expires-at`: kutu, derlemeler arasında kendini kaldırır. Sunucu
  // bir sonraki koşuda bloğu zaten sökecek; damga aradaki boşlukta okuyucunun
  // ana sayfasında bayat bir "canlı" kutusu kalmasını önler.
  return `
<section class="container fms fms--${escapeHtml(phase)}" data-featured-match-spotlight data-fms-locale="${locale}" data-fms-phase="${escapeHtml(phase)}" data-fms-kickoff="${escapeHtml(view.kickoff || "")}" data-fms-home="${escapeHtml(view.homeTeam)}" data-fms-away="${escapeHtml(view.awayTeam)}" data-fms-href="${escapeHtml(view.href)}"${view.query ? ` data-fms-query="${escapeHtml(view.query)}"` : ""}${view.expiresAt ? ` data-fms-expires-at="${escapeHtml(view.expiresAt)}"` : ""} aria-labelledby="fms-title">
  <div class="fms__inner">
    <div class="fms__head">
      <span class="fms__badge" data-fms-badge>${escapeHtml(copy.badge[phase])}</span>
      ${view.league ? `<span class="fms__league">${escapeHtml(view.league)}</span>` : ""}
    </div>
    <h2 class="fms__title" id="fms-title"><a href="${escapeHtml(view.href)}" data-fms-title>${escapeHtml(title)}</a></h2>
    ${scoreBoard}
    <p class="fms__lead" data-fms-lead>${escapeHtml(copy.lead[phase])}</p>
    ${facts ? `<dl class="fms__facts">${facts}</dl>` : ""}
    <a class="fms__cta" href="${escapeHtml(view.href)}" data-fms-cta>${escapeHtml(copy.cta[phase])} <span aria-hidden="true">→</span></a>
    <nav class="fms__jumps" aria-label="${escapeHtml(copy.aria)}">${links}</nav>
  </div>
</section>`;
}

/**
 * Takım ve lig sayfasındaki ince bağlantı şeridi. Ana sayfadaki kutuyla
 * aynı maça gider; amaç okuyucuyu maç sayfasına taşımak ve maç sayfasına
 * konu ile ilgili iç bağlantı vermek.
 */
export function spotlightStrip(view, options) {
  const locale = options && options.locale === "en" ? "en" : "tr";
  const copy = STRINGS[locale];
  if (!view || !view.href) return "";

  const phase = copy.badge[view.phase] ? view.phase : "pre";
  const title = spotlightTitle({ ...view, phase }, locale);
  const href = (options && options.href) || view.href;

  return `
<aside class="fms-strip fms-strip--${escapeHtml(phase)}" data-featured-match-strip>
  <span class="fms-strip__badge">${escapeHtml(copy.badge[phase])}</span>
  <a class="fms-strip__link" href="${escapeHtml(href)}">${escapeHtml(title)}</a>
  <span class="fms-strip__cta">${escapeHtml(copy.cta[phase])} <span aria-hidden="true">→</span></span>
</aside>`;
}

export { STRINGS, scoreText };
