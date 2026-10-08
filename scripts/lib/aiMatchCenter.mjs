/**
 * AI MAÇ MERKEZİ — BÖLÜM İŞARETLEMESİ (TR + EN, TEK KAYNAK).
 *
 * `services/aiMatchCenter.js` yapısal okumayı üretir; bu dosya onu ekrana
 * çizer. İki dil AYNI fonksiyonlardan geçer: bileşen listesi, sıra, sınıf
 * adları ve veri kapıları birebir aynıdır — yalnızca `AI_STR[locale]`
 * sözlüğündeki kelimeler ve sayı biçimi (ondalık ayracı) değişir.
 *
 * NEDEN AYRI BİR "EN ŞABLONU" YOK.
 *
 * Bu depoda İngilizce maç ÖNÜ sayfaları bir zamanlar kendi işaretlemesini
 * kuruyordu (scripts/generate-en-match-pages.mjs) ve TR'de olan bölümler
 * EN'de eksik kalabiliyordu. AI Maç Merkezi o hatayı tekrarlamasın diye
 * ilk satırından itibaren tek kaynaktan çizilir: bir bileşen eklendiğinde
 * iki dilde birden doğar, silindiğinde ikisinden birden düşer.
 *
 * MOBİL ÖNCELİKLİ — VE MASAÜSTÜNDE EKSİKSİZ.
 *
 * İşaretleme tek sütun için yazılır; masaüstü düzeni page.css içinde
 * yalnızca ızgara genişletilerek kurulur. Yani mobilde gizlenen bir
 * bileşen YOKTUR: masaüstünde görünen her kutu mobilde de basılır,
 * sadece alt alta gelir. Ekrandan düşen tek şey, verisi olmayan bölümdür.
 *
 * SEKME: JS'SİZ ÇALIŞIR.
 *
 * Sekmeler gizli radyo düğmesi + `label[role="tab"]` ile kurulur; seçim
 * CSS ile yapılır. site.js yalnızca klavye gezinmesini ve `aria-selected`
 * eşitlemesini ekler (bkz. site.js `[role="tablist"]`). Betik yüklenmese
 * bile sekmeler çalışır ve canlı skor akışına tek bir işlem bile eklemez.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DRIVER_ORDER } = require("../../services/aiMatchCenter.js");

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const NUMBER_LOCALE = { tr: "tr-TR", en: "en-GB" };

/** Ondalıklı sayı, sayfanın diline göre. TR virgül, EN nokta kullanır. */
function num(value, locale, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "";
  return new Intl.NumberFormat(NUMBER_LOCALE[locale] || "tr-TR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(Number(value));
}

/** Tam sayı (maç sayısı, sıra, eksik adedi). */
function int(value, locale) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "";
  return new Intl.NumberFormat(NUMBER_LOCALE[locale] || "tr-TR", { maximumFractionDigits: 0 }).format(Number(value));
}

/** Yüzde işaretinin yeri dile göre değişir: TR "%62", EN "62%". */
function pct(value, locale) {
  const rounded = Math.round(Number(value));
  if (!Number.isFinite(rounded)) return "";
  return locale === "en" ? `${rounded}%` : `%${rounded}`;
}

/**
 * İKİ DİLLİ SÖZLÜK.
 *
 * `tr` ve `en` anahtar kümeleri BİREBİR aynı olmak zorundadır;
 * scripts/test-ai-match-center.mjs bunu mekanik olarak doğrular. Eksik
 * anahtar, kullanıcıya ham anahtar göstermek demektir.
 */
export const AI_STR = {
  tr: {
    tabMatch: "Maç",
    tabAi: "Maç Analizi",
    tabsLabel: "Maç sayfası bölümleri",
    title: "Ücretsiz Maç Analizi",
    proBadge: "Ücretsiz",
    proFree: "Tüm kullanıcılar için ücretsiz",
    intro: "Aşağıdaki okuma, bu maç için doğrulanmış verilerden üretilir. Verisi olmayan bölüm hiç çizilmez; tahmin cümlesi yazılmaz.",
    empty: "Güvenilir analiz için yeterli veri bulunmuyor.",
    outcomeTitle: "Maç sonucu ihtimalleri",
    drawLabel: "Beraberlik",
    sourceLabel: "Kaynak",
    liveBadge: "Canlı",
    liveNote: "Maç sürerken ihtimaller arka planda yenilenir; skor akışı beklemez.",
    livePreReading: "Bu yüzdeler maç ÖNCESİ okumadır, başlama vuruşunda dondurulmuştur. Maç içi kazanma olasılığı için doğrulanmış bir model yok; skordan yüzde türetilmez.",
    liveDataTitle: "Canlı veri okuması",
    liveDataPending: "Maç başladığında canlı maç istatistiklerinden üretilen okuma burada açılır.",
    whyTitle: "Bu yüzdeler neye dayanıyor?",
    whyLead: "Ölçülen farklar:",
    whyBalanced: "Ölçülen girdilerde iki takım arasında belirgin bir fark oluşmadı; yüzdeler bu yüzden birbirine yakın.",
    whyNote: "Bu satırlar yalnızca ölçülmüş girdileri açıklar; gösterilen yüzdenin kaynağı ayrı etiketlenir.",
    confidenceTitle: "Güven seviyesi",
    confidenceLevels: { high: "Yüksek", medium: "Orta", low: "Düşük" },
    confidenceBasis: "Dayandığı örneklem",
    confidenceMatches: (home, away) => `Ev sahibi ${home} maç · Deplasman ${away} maç`,
    confidenceVenue: (home, away) => `İç sahada ${home} maç · Deplasmanda ${away} maç`,
    confidenceH2h: (count) => `İkili rekabet ${count} maç`,
    confidenceLow: "Örneklem dar; okumayı temkinli değerlendirin.",
    formTitle: "Son 5 maç formu",
    formPoints: (points, played) => `${points} puan / ${played} maç`,
    formLegend: "G galibiyet, B beraberlik, M mağlubiyet",
    win: "G",
    draw: "B",
    loss: "M",
    attackTitle: "Hücum - savunma karşılaştırması",
    attackLabel: "Hücum gücü",
    defenseLabel: "Savunma gücü",
    attackScale: "Lig ortalaması 1,00 kabul edilir. Hücumda yüksek sayı daha çok gol, savunmada düşük sayı daha az yenilen gol demektir.",
    xgLabel: "Model beklenen gol",
    winRateLabel: "Galibiyet oranı",
    cleanSheetLabel: "Gol yemeden biten maç",
    ppgLabel: "Maç başına puan",
    absenceTitle: "Eksiklerin etkisi",
    absenceCount: (count) => `${count} bildirilen eksik`,
    absenceNone: "Bu takım için bildirilen eksik oyuncu yok.",
    absenceEffect: "Bildirilen eksikler modelin hücum beklentisini oyuncu başına düşürür; etki oyuncu sayısıyla sınırlıdır.",
    absenceStatus: { injured: "Sakat", suspended: "Cezalı", doubtful: "Şüpheli", out: "Yok", unavailable: "Yok" },
    lineupTitle: "Muhtemel 11'in etkisi",
    lineupOfficial: "Resmî 11 açıklandı",
    lineupPredicted: "Muhtemel 11 — resmî değil",
    lineupFormation: "Diziliş",
    lineupMissing: "Eksikliği hissedilebilecek oyuncular",
    lineupNote: "Muhtemel 11 doğrulanmış kadro verisinden derlenir; resmî kadro açıklandığında bu bölüm otomatik güncellenir.",
    h2hTitle: "İkili rekabet",
    h2hSummary: (played) => `Son ${played} karşılaşma`,
    summaryTitle: "Maçın Özeti",
    summaryLeanHome: (home, percent) => `Ölçülen veriler en yüksek ihtimali ${home} tarafına veriyor (${percent}).`,
    summaryLeanAway: (away, percent) => `Ölçülen veriler en yüksek ihtimali ${away} tarafına veriyor (${percent}).`,
    summaryLeanDraw: (percent) => `Ölçülen veriler en yüksek ihtimali beraberliğe veriyor (${percent}).`,
    summaryNarrow: "İlk iki seçenek arasındaki fark dar.",
    summaryBalanced: "Ölçülen girdiler başa baş bir maça işaret ediyor.",
    summaryDrivers: (list) => `Öne çıkan başlıklar: ${list}.`,
    summaryResult: (home, away) => `Maç ${home}-${away} tamamlandı.`,
    summaryConfidence: (level) => `Veri güveni: ${level}.`,
    leanHome: "lehine",
    leanAway: "lehine",
    balanced: "Dengeli",
    strong: "Belirgin",
    slight: "Hafif",
    driverLabels: {
      attack: "Hücum üretimi",
      defense: "Savunma direnci",
      form: "Son dönem formu",
      absence: "Kadro eksikleri",
      h2h: "İkili rekabet",
      rank: "Lig sırası"
    },
    driverUnits: {
      attack: "lig ortalamasına oran",
      defense: "lig ortalamasına oran",
      form: "maç başına puan sapması",
      absence: "bildirilen eksik",
      h2h: "maç başına ortalama gol farkı",
      rank: "lig sırası"
    },
    disclaimer: "Yüzdeler ve okumalar istatistiksel değerlendirmedir; kesin sonuç ya da bahis önerisi değildir."
  },
  en: {
    tabMatch: "Match",
    tabAi: "Match Analysis",
    tabsLabel: "Match page sections",
    title: "Free Match Analysis",
    proBadge: "Free",
    proFree: "Free for every user",
    intro: "The reading below is built from verified data for this match. Any section without data is not drawn at all, and no speculative sentence is written.",
    empty: "There is not enough data for a reliable analysis.",
    outcomeTitle: "Match result probabilities",
    drawLabel: "Draw",
    sourceLabel: "Source",
    liveBadge: "Live",
    liveNote: "Probabilities refresh in the background while the match runs; the score feed never waits for them.",
    livePreReading: "These percentages are a PRE-MATCH reading, frozen at kick-off. No verified in-play win-probability model exists, so no percentage is derived from the score.",
    liveDataTitle: "Live data reading",
    liveDataPending: "Once the match kicks off, a reading built from live match statistics opens here.",
    whyTitle: "What are these percentages based on?",
    whyLead: "Measured gaps:",
    whyBalanced: "No clear gap emerged between the two sides in the measured inputs, which is why the percentages sit close together.",
    whyNote: "These rows explain the measured inputs only; the source of the displayed percentage is labelled separately.",
    confidenceTitle: "Confidence level",
    confidenceLevels: { high: "High", medium: "Medium", low: "Low" },
    confidenceBasis: "Sample it rests on",
    confidenceMatches: (home, away) => `Home side ${home} matches · Away side ${away} matches`,
    confidenceVenue: (home, away) => `${home} home matches · ${away} away matches`,
    confidenceH2h: (count) => `${count} head-to-head matches`,
    confidenceLow: "The sample is narrow; read the output with caution.",
    formTitle: "Last 5 matches form",
    formPoints: (points, played) => `${points} points / ${played} matches`,
    formLegend: "W win, D draw, L loss",
    win: "W",
    draw: "D",
    loss: "L",
    attackTitle: "Attack - defence comparison",
    attackLabel: "Attacking output",
    defenseLabel: "Defensive record",
    attackScale: "League average counts as 1.00. In attack a higher number means more goals scored; in defence a lower number means fewer goals conceded.",
    xgLabel: "Model expected goals",
    winRateLabel: "Win rate",
    cleanSheetLabel: "Clean sheet rate",
    ppgLabel: "Points per match",
    absenceTitle: "Impact of absences",
    absenceCount: (count) => `${count} reported absentees`,
    absenceNone: "No absentees have been reported for this side.",
    absenceEffect: "Reported absences lower the model's attacking expectation per player; the effect is capped by the number of players.",
    absenceStatus: { injured: "Injured", suspended: "Suspended", doubtful: "Doubtful", out: "Out", unavailable: "Out" },
    lineupTitle: "Impact of the probable XI",
    lineupOfficial: "Official XI confirmed",
    lineupPredicted: "Probable XI — not official",
    lineupFormation: "Formation",
    lineupMissing: "Players whose absence may be felt",
    lineupNote: "The probable XI is compiled from verified squad data; this section updates automatically once the official line-up is announced.",
    h2hTitle: "Head to head",
    h2hSummary: (played) => `Last ${played} meetings`,
    summaryTitle: "Short match summary",
    summaryLeanHome: (home, percent) => `The measured data gives ${home} the highest probability (${percent}).`,
    summaryLeanAway: (away, percent) => `The measured data gives ${away} the highest probability (${percent}).`,
    summaryLeanDraw: (percent) => `The measured data gives the draw the highest probability (${percent}).`,
    summaryNarrow: "The gap between the top two outcomes is narrow.",
    summaryBalanced: "The measured inputs point to an evenly matched game.",
    summaryDrivers: (list) => `Leading factors: ${list}.`,
    summaryResult: (home, away) => `The match finished ${home}-${away}.`,
    summaryConfidence: (level) => `Data confidence: ${level}.`,
    leanHome: "favours",
    leanAway: "favours",
    balanced: "Even",
    strong: "Clear",
    slight: "Slight",
    driverLabels: {
      attack: "Attacking output",
      defense: "Defensive resistance",
      form: "Recent form",
      absence: "Squad absences",
      h2h: "Head to head",
      rank: "League position"
    },
    driverUnits: {
      attack: "ratio to league average",
      defense: "ratio to league average",
      form: "points-per-match swing",
      absence: "reported absentees",
      h2h: "average goal difference per match",
      rank: "league position"
    },
    disclaimer: "Probabilities and readings are a statistical assessment; they are not a certain outcome or betting advice."
  }
};

/** Bir sürücünün hangi takımın lehine olduğunu okunur hâle getirir. */
function leanText(driver, ctx) {
  const { locale, homeTeam, awayTeam } = ctx;
  const text = AI_STR[locale];
  if (driver.lean === "balanced") return text.balanced;
  const team = driver.lean === "home" ? homeTeam : awayTeam;
  const size = driver.strength === "strong" ? text.strong : text.slight;
  return locale === "en" ? `${size} — ${text.leanHome} ${team}` : `${size} — ${team} ${text.leanHome}`;
}

/** Sürücü değerinin ekrandaki biçimi anahtarına göre değişir. */
function driverValue(driver, side, locale) {
  const value = driver.values ? driver.values[side] : null;
  if (value === null || value === undefined) return "-";
  if (driver.key === "absence" || driver.key === "rank") return int(value, locale) || "-";
  if (driver.key === "h2h" || driver.key === "form") {
    const formatted = num(value, locale, 2);
    if (!formatted) return "-";
    return Number(value) > 0 ? `+${formatted}` : formatted;
  }
  return num(value, locale, 2) || "-";
}

/**
 * 1) MAÇ SONUCU İHTİMALLERİ — 1-X-2.
 *
 * Bar ve yüzdeler. Kaynak etiketi zorunludur: okuyucu sayının sağlayıcıdan
 * mı, piyasa oranından mı, FutbolRadar modelinden mi geldiğini görür.
 * Canlı maçta bar `data-ai-outcome` ile işaretlenir; istemci bu düğümü
 * arka planda tazeler (bkz. ai-match-center.js).
 */
export function outcomeHtml(outcome, ctx) {
  if (!outcome) return "";
  const { locale, homeTeam, awayTeam, sourceLabel } = ctx;
  const text = AI_STR[locale];
  const top = Math.max(outcome.home, outcome.draw, outcome.away);
  const cell = (label, value, cls) => `<div class="ai-outcome-cell${value === top ? " is-top" : ""}"><span>${escapeHtml(label)}</span><b data-ai-${cls}>${escapeHtml(pct(value, locale))}</b></div>`;
  const aria = locale === "en"
    ? `${homeTeam} ${outcome.home}%, draw ${outcome.draw}%, ${awayTeam} ${outcome.away}%`
    : `${homeTeam} yüzde ${outcome.home}, beraberlik yüzde ${outcome.draw}, ${awayTeam} yüzde ${outcome.away}`;
  return `<section class="ai-block ai-outcome" data-ai-outcome aria-labelledby="ai-outcome-title">
        <h3 id="ai-outcome-title" class="ai-block-title">${escapeHtml(text.outcomeTitle)}</h3>
        <div class="ai-outcome-bar" role="img" aria-label="${escapeHtml(aria)}">
          <span class="is-home" style="width:${outcome.home}%" data-ai-bar-home></span><span class="is-draw" style="width:${outcome.draw}%" data-ai-bar-draw></span><span class="is-away" style="width:${outcome.away}%" data-ai-bar-away></span>
        </div>
        <div class="ai-outcome-legend">${cell(homeTeam, outcome.home, "home")}${cell(text.drawLabel, outcome.draw, "draw")}${cell(awayTeam, outcome.away, "away")}</div>
        ${sourceLabel ? `<p class="ai-source muted-copy"><b>${escapeHtml(text.sourceLabel)}:</b> ${escapeHtml(sourceLabel)}</p>` : ""}
        ${ctx.state === "live" ? `<p class="ai-warn">${escapeHtml(text.livePreReading)}</p>` : ""}
      </section>`;
}

/**
 * 2) AÇIKLAMA — "BU YÜZDELER NEYE DAYANIYOR?".
 *
 * Kısa ama veriye dayalı: her satır ÖLÇÜLMÜŞ iki sayıyı ve hangi tarafın
 * lehine olduğunu gösterir. Belirgin fark yoksa bunu da açıkça söyler —
 * "favori şu" diye bir cümle uydurulmaz.
 */
export function driversHtml(drivers, ctx) {
  const list = Array.isArray(drivers) ? drivers : [];
  if (!list.length) return "";
  const { locale, homeTeam, awayTeam } = ctx;
  const text = AI_STR[locale];
  const decisive = list.filter((driver) => driver.strength !== "balanced");
  const lead = decisive.length
    ? `<p class="ai-why-lead">${escapeHtml(text.whyLead)} ${decisive.slice(0, 3).map((driver) => `<b>${escapeHtml(text.driverLabels[driver.key] || driver.key)}</b> ${escapeHtml(leanText(driver, ctx))}`).join(" · ")}</p>`
    : `<p class="ai-why-lead">${escapeHtml(text.whyBalanced)}</p>`;
  const rows = list.map((driver) => `<li class="ai-why-row is-${escapeHtml(driver.lean)}">
          <span class="ai-why-name">${escapeHtml(text.driverLabels[driver.key] || driver.key)}<small>${escapeHtml(text.driverUnits[driver.key] || "")}</small></span>
          <span class="ai-why-values"><b>${escapeHtml(driverValue(driver, "home", locale))}</b><i aria-hidden="true">·</i><b>${escapeHtml(driverValue(driver, "away", locale))}</b></span>
          <span class="ai-why-lean">${escapeHtml(leanText(driver, ctx))}</span>
        </li>`).join("");
  return `<section class="ai-block ai-why" aria-labelledby="ai-why-title">
        <h3 id="ai-why-title" class="ai-block-title">${escapeHtml(text.whyTitle)}</h3>
        ${lead}
        <ul class="ai-why-list">
          <li class="ai-why-row is-head" aria-hidden="true"><span class="ai-why-name"></span><span class="ai-why-values"><b>${escapeHtml(homeTeam)}</b><i>·</i><b>${escapeHtml(awayTeam)}</b></span><span class="ai-why-lean"></span></li>
          ${rows}
        </ul>
        <p class="ai-note muted-copy">${escapeHtml(text.whyNote)}</p>
      </section>`;
}

/**
 * 3) GÜVEN SEVİYESİ — hangi örnekleme dayandığıyla birlikte.
 *
 * Ham sayı (0-100) EKRANA YAZILMAZ. Model bu değeri "kaç ayaklı duruyorum"
 * ölçüsü olarak üretir (services/fixtureProbabilityModel.js#computeConfidence),
 * ölçülmüş bir olasılık olarak değil; "%67 güven" diye basmak, olmayan bir
 * kesinliği iddia etmek olurdu. Okuyucuya üç şey verilir: düzey adı,
 * görsel çubuk ve güvenin DAYANDIĞI örneklem — yani sayının kendisi yerine
 * sayının nedeni.
 */
export function confidenceHtml(confidence, ctx) {
  if (!confidence) return "";
  const { locale } = ctx;
  const text = AI_STR[locale];
  const basis = confidence.basis || {};
  const lines = [];
  if (Number.isFinite(basis.homeMatches) && Number.isFinite(basis.awayMatches)) {
    lines.push(text.confidenceMatches(int(basis.homeMatches, locale), int(basis.awayMatches, locale)));
  }
  if (Number.isFinite(basis.homeVenueMatches) && Number.isFinite(basis.awayVenueMatches)) {
    lines.push(text.confidenceVenue(int(basis.homeVenueMatches, locale), int(basis.awayVenueMatches, locale)));
  }
  if (Number.isFinite(basis.h2hMatches) && basis.h2hMatches > 0) {
    lines.push(text.confidenceH2h(int(basis.h2hMatches, locale)));
  }
  return `<section class="ai-block ai-confidence is-${escapeHtml(confidence.level)}" aria-labelledby="ai-confidence-title">
        <h3 id="ai-confidence-title" class="ai-block-title">${escapeHtml(text.confidenceTitle)}</h3>
        <p class="ai-confidence-head"><b data-ai-confidence-level>${escapeHtml(text.confidenceLevels[confidence.level])}</b></p>
        <div class="ai-confidence-meter" role="img" aria-label="${escapeHtml(`${text.confidenceTitle}: ${text.confidenceLevels[confidence.level]}`)}"><span style="width:${Math.max(0, Math.min(100, confidence.score))}%" data-ai-confidence-bar></span></div>
        ${lines.length ? `<p class="ai-confidence-basis muted-copy"><b>${escapeHtml(text.confidenceBasis)}:</b> ${escapeHtml(lines.join(" · "))}</p>` : ""}
        ${confidence.level === "low" ? `<p class="ai-warn">${escapeHtml(text.confidenceLow)}</p>` : ""}
      </section>`;
}

/** 4) SON 5 MAÇ FORM GRAFİĞİ — iki takım yan yana, mobilde alt alta. */
export function formHtml(form, ctx) {
  if (!form) return "";
  const { locale, homeTeam, awayTeam } = ctx;
  const text = AI_STR[locale];
  const side = (block, teamName) => {
    if (!block) return "";
    const letter = (result) => (result === "W" ? text.win : result === "L" ? text.loss : text.draw);
    const dots = block.results.map((row) => `<span class="${row.result === "W" ? "win" : row.result === "L" ? "loss" : "draw"}" title="${escapeHtml(row.label)}">${escapeHtml(letter(row.result))}</span>`).join("");
    const maxPoints = block.played * 3;
    const width = maxPoints > 0 ? Math.round((block.points / maxPoints) * 100) : 0;
    return `<article class="ai-form-side">
          <h4>${escapeHtml(teamName)}</h4>
          <div class="form-dots ai-form-dots">${dots}</div>
          <div class="ai-form-meter" role="img" aria-label="${escapeHtml(`${teamName}: ${text.formPoints(block.points, block.played)}`)}"><span style="width:${width}%"></span></div>
          <p class="ai-form-points">${escapeHtml(text.formPoints(int(block.points, locale), int(block.played, locale)))}</p>
        </article>`;
  };
  return `<section class="ai-block ai-form" aria-labelledby="ai-form-title">
        <h3 id="ai-form-title" class="ai-block-title">${escapeHtml(text.formTitle)}</h3>
        <div class="ai-two">${side(form.home, homeTeam)}${side(form.away, awayTeam)}</div>
        <p class="ai-note muted-copy">${escapeHtml(text.formLegend)}</p>
      </section>`;
}

/** 5) HÜCUM - SAVUNMA KARŞILAŞTIRMASI. */
export function attackDefenseHtml(attackDefense, ctx) {
  if (!attackDefense) return "";
  const { locale, homeTeam, awayTeam } = ctx;
  const text = AI_STR[locale];
  // Ölçek: lig ortalaması 1,00. Barlar 0,5-1,5 aralığını doldurur; dışına
  // taşan değer kırpılır, uydurulmaz.
  const barWidth = (value) => Math.max(4, Math.min(100, Math.round(((Number(value) - 0.5) / 1) * 100)));
  const row = (label, homeValue, awayValue, invert) => {
    if (homeValue === null && awayValue === null) return "";
    const better = homeValue === null || awayValue === null
      ? null
      : invert
        ? (homeValue < awayValue ? "home" : homeValue > awayValue ? "away" : null)
        : (homeValue > awayValue ? "home" : homeValue < awayValue ? "away" : null);
    return `<div class="ai-ad-row">
          <b class="${better === "home" ? "is-better" : ""}">${escapeHtml(num(homeValue, locale, 2) || "-")}</b>
          <span class="ai-ad-label">
            <i class="ai-ad-bars" aria-hidden="true"><em class="is-home" style="width:${homeValue === null ? 0 : barWidth(homeValue)}%"></em><em class="is-away" style="width:${awayValue === null ? 0 : barWidth(awayValue)}%"></em></i>
            <span>${escapeHtml(label)}</span>
          </span>
          <b class="${better === "away" ? "is-better" : ""}">${escapeHtml(num(awayValue, locale, 2) || "-")}</b>
        </div>`;
  };
  const rate = (label, homeValue, awayValue) => {
    if (homeValue === null && awayValue === null) return "";
    return `<div class="ai-ad-row is-rate"><b>${escapeHtml(homeValue === null ? "-" : pct(homeValue * 100, locale))}</b><span class="ai-ad-label"><span>${escapeHtml(label)}</span></span><b>${escapeHtml(awayValue === null ? "-" : pct(awayValue * 100, locale))}</b></div>`;
  };
  const xg = attackDefense.expectedGoals
    ? `<div class="ai-ad-row is-rate"><b>${escapeHtml(num(attackDefense.expectedGoals.home, locale, 2))}</b><span class="ai-ad-label"><span>${escapeHtml(text.xgLabel)}</span></span><b>${escapeHtml(num(attackDefense.expectedGoals.away, locale, 2))}</b></div>`
    : "";
  return `<section class="ai-block ai-ad" aria-labelledby="ai-ad-title">
        <h3 id="ai-ad-title" class="ai-block-title">${escapeHtml(text.attackTitle)}</h3>
        <div class="ai-ad-head"><span>${escapeHtml(homeTeam)}</span><span></span><span>${escapeHtml(awayTeam)}</span></div>
        ${row(text.attackLabel, attackDefense.home.attack, attackDefense.away.attack, false)}
        ${row(text.defenseLabel, attackDefense.home.defense, attackDefense.away.defense, true)}
        ${rate(text.winRateLabel, attackDefense.home.winRate, attackDefense.away.winRate)}
        ${rate(text.cleanSheetLabel, attackDefense.home.cleanSheetRate, attackDefense.away.cleanSheetRate)}
        ${xg}
        <p class="ai-note muted-copy">${escapeHtml(text.attackScale)}</p>
      </section>`;
}

/** 6) EKSİKLERİN ETKİSİ. Bildirim yoksa taraf hiç çizilmez. */
export function absenceHtml(absence, ctx) {
  if (!absence) return "";
  const { locale, homeTeam, awayTeam } = ctx;
  const text = AI_STR[locale];
  const side = (block, teamName) => {
    if (!block) return "";
    const players = block.players.length
      ? `<ul class="ai-absence-list">${block.players.slice(0, 8).map((player) => `<li><span>${escapeHtml(player.name)}</span>${player.status && text.absenceStatus[player.status] ? `<small class="is-${escapeHtml(player.status)}">${escapeHtml(text.absenceStatus[player.status])}</small>` : ""}</li>`).join("")}</ul>`
      : `<p class="ai-absence-none muted-copy">${escapeHtml(text.absenceNone)}</p>`;
    return `<article class="ai-absence-side">
          <h4>${escapeHtml(teamName)}<span class="ai-absence-count">${escapeHtml(text.absenceCount(int(block.count, locale)))}</span></h4>
          ${players}
        </article>`;
  };
  return `<section class="ai-block ai-absence" aria-labelledby="ai-absence-title">
        <h3 id="ai-absence-title" class="ai-block-title">${escapeHtml(text.absenceTitle)}</h3>
        <div class="ai-two">${side(absence.home, homeTeam)}${side(absence.away, awayTeam)}</div>
        <p class="ai-note muted-copy">${escapeHtml(text.absenceEffect)}</p>
      </section>`;
}

/** 7) MUHTEMEL 11'İN ETKİSİ. */
export function lineupHtml(lineup, ctx) {
  if (!lineup) return "";
  const { locale, homeTeam, awayTeam } = ctx;
  const text = AI_STR[locale];
  let anyPredicted = false;
  const side = (block, teamName) => {
    if (!block) return "";
    if (block.status === "predicted") anyPredicted = true;
    const missing = block.missingKeyPlayers.length
      ? `<div class="ai-lineup-missing"><span>${escapeHtml(text.lineupMissing)}</span><div class="ai-chips">${block.missingKeyPlayers.slice(0, 6).map((name) => `<span class="ai-chip is-missing">${escapeHtml(name)}</span>`).join("")}</div></div>`
      : "";
    return `<article class="ai-lineup-side">
          <h4>${escapeHtml(teamName)}</h4>
          <p class="ai-lineup-status is-${escapeHtml(block.status)}">${escapeHtml(block.status === "official" ? text.lineupOfficial : text.lineupPredicted)}</p>
          ${block.formation ? `<p class="ai-lineup-formation"><b>${escapeHtml(text.lineupFormation)}:</b> ${escapeHtml(block.formation)}</p>` : ""}
          ${missing}
        </article>`;
  };
  const body = `<div class="ai-two">${side(lineup.home, homeTeam)}${side(lineup.away, awayTeam)}</div>`;
  return `<section class="ai-block ai-lineup" aria-labelledby="ai-lineup-title">
        <h3 id="ai-lineup-title" class="ai-block-title">${escapeHtml(text.lineupTitle)}</h3>
        ${body}
        ${anyPredicted ? `<p class="ai-note muted-copy">${escapeHtml(text.lineupNote)}</p>` : ""}
      </section>`;
}

/** 8) İKİLİ REKABET (H2H). */
export function h2hHtml(h2h, ctx) {
  if (!h2h) return "";
  const { locale, homeTeam, awayTeam, shortDate } = ctx;
  const text = AI_STR[locale];
  const dateOf = (value) => (typeof shortDate === "function" ? shortDate(value, locale) : "");
  return `<section class="ai-block ai-h2h" aria-labelledby="ai-h2h-title">
        <h3 id="ai-h2h-title" class="ai-block-title">${escapeHtml(text.h2hTitle)}</h3>
        <p class="ai-h2h-summary"><span><b>${escapeHtml(int(h2h.homeWins, locale))}</b> ${escapeHtml(homeTeam)}</span><span><b>${escapeHtml(int(h2h.draws, locale))}</b> ${escapeHtml(text.drawLabel)}</span><span><b>${escapeHtml(int(h2h.awayWins, locale))}</b> ${escapeHtml(awayTeam)}</span></p>
        <ul class="ai-h2h-list">${h2h.entries.map((entry) => `<li>${entry.date ? `<time datetime="${escapeHtml(String(entry.date).slice(0, 10))}">${escapeHtml(dateOf(entry.date))}</time>` : ""}<span>${escapeHtml(entry.homeTeam)} <b>${escapeHtml(int(entry.homeGoals, locale))}-${escapeHtml(int(entry.awayGoals, locale))}</b> ${escapeHtml(entry.awayTeam)}</span></li>`).join("")}</ul>
        <p class="ai-note muted-copy">${escapeHtml(text.h2hSummary(int(h2h.played, locale)))}</p>
      </section>`;
}

/**
 * 9) KISA MAÇ ÖZETİ.
 *
 * Cümleler sözlükteki kalıplardan, yapısal özetin anahtarlarıyla kurulur.
 * Hiçbir kalıp veriyi aşmaz: "üstünlük" cümlesi yalnızca ölçülmüş yüzde
 * farkı varken, "öne çıkan başlıklar" yalnızca belirgin sürücü varken
 * yazılır.
 */
export function summaryHtml(summary, ctx) {
  if (!summary) return "";
  const { locale, homeTeam, awayTeam } = ctx;
  const text = AI_STR[locale];
  const parts = [];
  if (summary.result) {
    parts.push(text.summaryResult(int(summary.result.home, locale), int(summary.result.away, locale)));
    const statNames = locale === 'en' ? {'Topla oynama':'Possession','Toplam şut':'Total shots','İsabetli şut':'Shots on target'} : {};
    for (const row of summary.statistics || []) {
      const unit = row.type === 'Topla oynama' ? '%' : '';
      parts.push(`${statNames[row.type] || row.type}: ${row.home}${unit} – ${row.away}${unit} (${homeTeam} / ${awayTeam}).`);
    }
    if (summary.redCards) parts.push(locale === 'en' ? `Verified red cards: ${summary.redCards}.` : `Doğrulanmış kırmızı kart: ${summary.redCards}.`);
  }
  if (summary.lean && summary.topPercent !== null && summary.topPercent !== undefined) {
    const percent = pct(summary.topPercent, locale);
    if (summary.lean === "home") parts.push(text.summaryLeanHome(homeTeam, percent));
    else if (summary.lean === "away") parts.push(text.summaryLeanAway(awayTeam, percent));
    else parts.push(text.summaryLeanDraw(percent));
    if (summary.narrow) parts.push(text.summaryNarrow);
  } else if (summary.balanced) {
    parts.push(text.summaryBalanced);
  }
  if (summary.topDrivers && summary.topDrivers.length) {
    parts.push(text.summaryDrivers(summary.topDrivers.map((driver) => text.driverLabels[driver.key] || driver.key).join(", ")));
  }
  if (summary.confidenceLevel) {
    parts.push(text.summaryConfidence(text.confidenceLevels[summary.confidenceLevel]));
  }
  if (!parts.length) return "";
  return `<section class="ai-block ai-summary" aria-labelledby="ai-summary-title">
        <h3 id="ai-summary-title" class="ai-block-title">${escapeHtml(text.summaryTitle)}</h3>
        <p data-ai-summary>${escapeHtml(parts.join(" "))}</p>
      </section>`;
}

/**
 * 10) CANLI VERİ OKUMASI — KABUK.
 *
 * Maç öncesi ve canlı sayfalarda basılır; gövdesini ai-match-center.js
 * doldurur. Kabuk boş bir kutu DEĞİLDİR: veri gelene kadar okuyucuya
 * neyin ne zaman açılacağını açıkça söyler — bu depoda canlı olay ve
 * istatistik bölümleri de aynı kalıbı kullanır.
 *
 * İçine SUNUCUDA hiçbir sayı basılmaz; buraya yazılacak her şey canlı
 * yanıtın kendisinden gelir.
 */
export function liveShellHtml(ctx) {
  const { locale, state } = ctx;
  if (state !== "pre" && state !== "live") return "";
  const text = AI_STR[locale];
  return `<section class="ai-block ai-live" data-ai-live aria-labelledby="ai-live-title">
        <h3 id="ai-live-title" class="ai-block-title">${escapeHtml(text.liveDataTitle)}</h3>
        <div data-ai-live-body><p class="ai-note muted-copy">${escapeHtml(text.liveDataPending)}</p></div>
      </section>`;
}

/**
 * AI MAÇ MERKEZİ PANELİ — TEK GİRİŞ NOKTASI.
 *
 * Bölüm sırası iki dilde de aynıdır ve `model.coverage` neyi çizeceğini
 * belirler. Hiçbir bileşen yoksa panel dürüst bir not basar; boş kutu
 * ya da uydurma cümle basmaz.
 */
export function aiMatchCenterPanelHtml(model, ctx) {
  const { locale } = ctx;
  const text = AI_STR[locale];
  const live = ctx.state === "live";
  const badge = `<span class="ai-pro-badge"><b>${escapeHtml(text.proBadge)}</b><span>${escapeHtml(text.proFree)}</span></span>`;
  const head = `<header class="ai-head">
        <div class="ai-head-row"><h2 class="ai-title">${escapeHtml(text.title)}</h2>${badge}${live ? `<span class="ai-live-badge"><i class="live-pulse" aria-hidden="true"></i>${escapeHtml(text.liveBadge)}</span>` : ""}</div>
        <p class="ai-intro muted-copy">${escapeHtml(text.intro)}</p>
        <p class="ai-note muted-copy">${locale === 'en' ? 'Team strength and form comparisons require at least 5 verified matches per team; head-to-head interpretation requires at least 2 meetings.' : 'Takım gücü ve form karşılaştırması için takım başına en az 5 doğrulanmış maç; ikili rekabet yorumu için en az 2 karşılaşma gerekir.'}</p>
        ${live ? `<p class="ai-note muted-copy">${escapeHtml(text.liveNote)}</p>` : ""}
      </header>`;

  if (!model || !model.available) {
    return `${head}<section class="ai-block"><article class="card data-empty"><strong>${escapeHtml(text.empty)}</strong></article></section>`;
  }

  const blocks = [
    model.insufficientAnalysis ? `<p class="ai-note">${locale === 'en' ? 'There is not enough data for a reliable analysis.' : 'Güvenilir analiz için yeterli veri bulunmuyor.'}</p>` : '',
    outcomeHtml(model.outcome, ctx),
    summaryHtml(model.summary, ctx),
    driversHtml(model.drivers, ctx),
    confidenceHtml(model.confidence, ctx),
    formHtml(model.form, ctx),
    attackDefenseHtml(model.attackDefense, ctx),
    absenceHtml(model.absence, ctx),
    lineupHtml(model.lineup, ctx),
    h2hHtml(model.h2h, ctx),
    liveShellHtml(ctx)
  ].filter(Boolean);

  if (!blocks.length) {
    return `${head}<section class="ai-block"><article class="card data-empty"><strong>${escapeHtml(text.empty)}</strong></article></section>`;
  }

  return `${head}
      <div class="ai-grid">${blocks.join("\n        ")}</div>
      <p class="ai-disclaimer muted-copy">${escapeHtml(text.disclaimer)}</p>`;
}

/**
 * SEKME KABUĞU — JS'SİZ ÇALIŞAN RADYO SEKMELERİ.
 *
 * `tabs`: [{ id, label, panel, checked }]. Radyo düğmeleri panellerden
 * ÖNCE gelir ki CSS `:checked ~` ile paneli seçebilsin. Paneller DOM'da
 * her zaman bulunur — seçili olmayan panel yalnızca görsel olarak
 * gizlenir, bu yüzden arama motoru ve ekran okuyucu içeriğin tamamına
 * erişir ve mevcut `#form`, `#son-maclar` gibi çapalar bozulmaz.
 */
export function tabsHtml(tabs, ctx) {
  const { locale } = ctx;
  const text = AI_STR[locale];
  const list = (Array.isArray(tabs) ? tabs : []).filter((tab) => tab && tab.id && tab.panel);
  if (list.length < 2) return list.length ? list[0].panel : "";
  const radios = list.map((tab, index) => `<input class="ai-tab-radio" type="radio" name="msp-tabs" id="msp-tab-${escapeHtml(tab.id)}"${tab.checked || (index === 0 && !list.some((item) => item.checked)) ? " checked" : ""} />`).join("");
  const labels = list.map((tab) => `<label class="ai-tab" role="tab" id="msp-tablabel-${escapeHtml(tab.id)}" for="msp-tab-${escapeHtml(tab.id)}" aria-controls="msp-panel-${escapeHtml(tab.id)}">${escapeHtml(tab.label)}${tab.badge ? `<span class="ai-tab-flag">${escapeHtml(tab.badge)}</span>` : ""}</label>`).join("");
  // Paneller <section>, sekme listesi <div>. Tür farkı bilinçli: CSS
  // seçili paneli `section:nth-of-type(n)` ile bulur ve sekme listesi
  // aynı türden olsaydı sıra bir kayardı.
  const panels = list.map((tab) => `<section class="ai-tab-panel" id="msp-panel-${escapeHtml(tab.id)}" role="tabpanel" aria-labelledby="msp-tablabel-${escapeHtml(tab.id)}" data-ai-panel="${escapeHtml(tab.id)}">
        ${tab.panel}
      </section>`).join("\n      ");
  return `<div class="ai-tabs" data-ai-tabs>
      ${radios}
      <div class="ai-tablist" role="tablist" aria-label="${escapeHtml(text.tabsLabel)}">${labels}</div>
      ${panels}
    </div>`;
}
