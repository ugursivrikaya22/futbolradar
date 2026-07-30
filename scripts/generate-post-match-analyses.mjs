/**
 * Tamamlanan HER maç için maç sonrası analiz kartı üretir.
 *
 * Çıktı: data/post-match-analyses.json — ana sayfa, maç merkezi ve
 * "Analizi hazır" sayacı bu tek dosyayı okur. Kaynak, yayın politikasının
 * tek uygulandığı yer olan `curatedMatches()`: elle doğrulanmış kayıtlar ile
 * sağlayıcı takvimi orada birleşiyor, bu yüzden skoru sağlayıcıdan gelen bir
 * maç da (olay/istatistik dökümü olmasa bile) kart alır.
 *
 * Bu script HİÇBİR sayı üretmez; yalnızca `postMatchAnalysisService`in
 * ölçülmüş veriden çıkardığı kartları dosyaya yazar. Verisi eksik maçın kartı
 * atılmaz, `dataStatus: "insufficient"` ile yazılır — okuyucu maçın oynandığını
 * ve analizin neden ince kaldığını birlikte görür.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const { curatedMatches } = require("../services/providers/mockProvider.js");
const { buildPostMatchAnalyses } = require("../services/postMatchAnalysisService.js");

const OUTPUT_PATH = path.join(root, "data", "post-match-analyses.json");
const PUBLIC_OUTPUT_PATH = path.join(root, "public", "data", "post-match-analyses.json");
const HOME_CARD_LIMIT = 6;

/**
 * Gerçekten yayımlanmış rapor sayfaları; olmayan bir sayfaya bağlantı
 * verilmez. `mac-raporu/` altındaki otomatik raporların yanı sıra kök
 * dizindeki elle yazılmış maç analizi sayfaları da (`match.analysisPage`)
 * kabul edilir — aksi halde en zengin raporu olan maçlar bağlantısız kalıyordu.
 */
function publishedReportPaths() {
  const paths = [];
  const dir = path.join(root, "mac-raporu");
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith(".html")) paths.push(`mac-raporu/${name}`);
    }
  }
  for (const name of fs.readdirSync(root)) {
    if (name.endsWith("-mac-analizi.html")) paths.push(name);
  }
  return paths;
}

function writeJson(target, payload) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(temp, target);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Istanbul"
  }).format(date);
}

/**
 * Maç sonrası analiz kartının HTML'i.
 *
 * İKİZİ: app.js -> `postMatchAnalysisCardHtml`. Statik çıktı ile istemci
 * çıktısı aynı iskeleti üretmek zorundadır; biri değişirse diğeri de
 * değişmeli (scripts/test-post-match-analysis-cards.mjs ikisinin de aynı
 * alanları taşıdığını doğrular).
 */
function analysisCardHtml(card) {
  const dateLabel = formatDate(card.kickoff);
  const meta = [card.league, dateLabel].filter(Boolean).join(" · ");

  const summary = card.summary.status === "ready"
    ? `<p class="pma-summary">${escapeHtml(card.summary.text)}</p>`
    : `<p class="pma-summary pma-missing">${escapeHtml(card.summary.reason)}</p>`;

  const turning = card.turningPoint.status === "unavailable"
    ? `<p class="pma-missing">${escapeHtml(card.turningPoint.reason)}</p>`
    : `<p>${escapeHtml(card.turningPoint.text)}</p>`;

  const performance = card.teamPerformance.status === "unavailable"
    ? `<p class="pma-missing">${escapeHtml(card.teamPerformance.reason)}</p>`
    : `<ul class="pma-notes">${["home", "away"].map((side) => {
      const entry = card.teamPerformance[side];
      if (!entry || !entry.notes.length) return "";
      const rating = entry.rating ? ` <b class="pma-rating">${escapeHtml(entry.rating.score)}/100</b>` : "";
      return `<li><span class="pma-note-team">${escapeHtml(entry.team)}</span>${rating}` +
        `<span class="pma-note-text">${escapeHtml(entry.notes[0].text)}</span>` +
        `<em class="pma-note-basis">${escapeHtml(entry.notes[0].basis)}</em></li>`;
    }).join("")}</ul>`;

  const link = card.reportUrl
    ? `<a class="pma-link" href="./${escapeHtml(card.reportUrl)}">Tam raporu aç</a>`
    : "";

  return `<article class="post-match-analysis-card" data-card="post-match-analysis" data-match="${escapeHtml(card.matchId || "")}" data-status="${escapeHtml(card.dataStatus)}">
      <div class="pma-top"><span class="pma-league">${escapeHtml(meta)}</span><span class="pma-status" data-status="${escapeHtml(card.dataStatus)}">${escapeHtml(card.dataStatusLabel)}</span></div>
      <div class="pma-score"><span class="pma-team">${escapeHtml(card.homeTeam)}</span><b class="pma-result">${escapeHtml(card.scoreLine || "–")}</b><span class="pma-team">${escapeHtml(card.awayTeam)}</span></div>
      ${summary}
      <div class="pma-block"><span class="pma-block-title">Kırılma anı</span>${turning}</div>
      <div class="pma-block"><span class="pma-block-title">Takım performansı</span>${performance}</div>
      <div class="pma-footer"><span class="pma-coverage">Veri kapsamı %${escapeHtml(card.coverage.percent)} · ${escapeHtml(card.coverage.measuredCount)}/${escapeHtml(card.coverage.totalCount)} ölçüm</span><span class="pma-confidence" data-level="${escapeHtml(card.confidence.level)}">Güven: ${escapeHtml(card.confidence.label)}</span></div>
      ${link}
    </article>`;
}

/**
 * Ana sayfadaki "Maç sonrası analizler" bloğu.
 *
 * Eskiden yalnızca skor + kapsam yüzdesi gösteren dört bağlantı vardı; kart
 * "analiz" adını taşıyıp analizin kendisini içermiyordu. Şimdi her kart beş
 * alanı da taşıyor ve verisi ince olan maç gizlenmek yerine "Veri yetersiz"
 * etiketiyle yayımlanıyor.
 */
function homeAnalysisBlock(cards) {
  const recent = cards.slice(0, HOME_CARD_LIMIT);
  if (!recent.length) return "";

  return `<section class="container section home-post-match-analyses" id="mac-sonrasi-analizler" data-api-section="post-match-analyses" aria-labelledby="home-post-match-analyses-title">
    <div class="section-head"><div class="section-title">
      <span class="section-kicker">Maç sonrası analizler</span>
      <h2 id="home-post-match-analyses-title">Tamamlanan maçların analizleri</h2>
      <p>Her tamamlanan maç için özet, kırılma anı, takım performansı, veri kapsamı ve güven seviyesi — yalnızca ölçülmüş veriden.</p>
    </div><a class="section-link" href="./mac-merkezi.html">Tüm raporlar</a></div>
    <div class="post-match-analysis-grid" data-api-target="post-match-analyses" data-static-fallback="true">${recent.map(analysisCardHtml).join("")}</div>
  </section>`;
}

/** Tek sahipli işaretleyici yazımı; kök ve public kopya birlikte güncellenir. */
function replaceOrInsert(file, startMarker, endMarker, content, beforeNeedle) {
  const filePath = path.join(root, file);
  if (!fs.existsSync(filePath)) return;
  let html = fs.readFileSync(filePath, "utf8");
  const block = `${startMarker}\n${content}\n${endMarker}`;
  const pattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
  if (pattern.test(html)) {
    html = html.replace(pattern, block);
  } else if (beforeNeedle && html.includes(beforeNeedle)) {
    html = html.replace(beforeNeedle, `${block}\n\n        ${beforeNeedle}`);
  } else {
    return;
  }
  fs.writeFileSync(filePath, html, "utf8");
  const publicPath = path.join(root, "public", file);
  if (fs.existsSync(path.dirname(publicPath))) {
    fs.writeFileSync(publicPath, html, "utf8");
  }
}

const matches = curatedMatches();
const cards = buildPostMatchAnalyses([matches], {
  publishedReports: publishedReportPaths(),
  generatedAt: new Date().toISOString()
});

const payload = {
  generatedAt: new Date().toISOString(),
  source: "FutbolRadar Post-Match Analysis",
  modelVersion: "futbolradar-post-match-v1",
  total: cards.length,
  complete: cards.filter((card) => card.dataStatus === "complete").length,
  partial: cards.filter((card) => card.dataStatus === "partial").length,
  insufficient: cards.filter((card) => card.dataStatus === "insufficient").length,
  analyses: cards
};

writeJson(OUTPUT_PATH, payload);
writeJson(PUBLIC_OUTPUT_PATH, payload);

replaceOrInsert(
  "index.html",
  "<!-- post-match-recent:start -->",
  "<!-- post-match-recent:end -->",
  homeAnalysisBlock(cards),
  '<section class="container section section-player-radar"'
);

console.log(
  `Generated ${cards.length} post-match analysis card(s): ` +
  `${payload.complete} complete, ${payload.partial} partial, ${payload.insufficient} insufficient.`
);
for (const card of cards) {
  console.log(
    `  - ${card.matchId} ${card.scoreLine || "?"} coverage=%${card.coverage.percent} ` +
    `confidence=${card.confidence.level} status=${card.dataStatus}`
  );
}
