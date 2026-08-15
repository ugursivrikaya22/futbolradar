#!/usr/bin/env node
/**
 * TAHMİN ANKETİNİ TÜRKÇE ANA SAYFAYA YAZ.
 *
 * İngilizce taraf `generate-en-pages.mjs` tarafından zaten her derlemede
 * yeniden üretiliyor; Türkçe `index.html` ise elle tutulan bir kabuk, bu
 * yüzden anket bloğu buradan işaretle sarılarak basılıyor.
 *
 * NEDEN DERLEME ANINDA BASILIYOR: gerekçe `scripts/lib/homePoll.mjs`
 * başlığında — mobilde ilk ekranda anket yerine boşluk vardı, kutu ancak
 * JavaScript yüklenip istek dönünce beliriyordu.
 *
 * TAKVİMDE ANKET YOKSA BLOK SİLİNİR. Kapanmış ve sıradaki henüz
 * başlamamışsa ana sayfada boş bir anket kutusu bırakmak, yer tutucu
 * uydurmanın sessiz biçimi olurdu.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { homePollBlock, pollPromoCardHtml, pollStickyWidgetHtml } from "./lib/homePoll.mjs";

const require = createRequire(import.meta.url);
const { localizePoll, logRejected, selectHomePoll } = require("../services/homePoll.js");

const root = process.cwd();
const CHECK_ONLY = process.argv.includes("--check");

function readJson(relative) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  } catch (error) {
    return null;
  }
}

function targetsFor(relativePath) {
  return [path.join(root, relativePath), path.join(root, "public", relativePath)]
    .filter((file) => fs.existsSync(file));
}

/**
 * BİR BLOĞU BİR APANKORDAN SONRA (YA DA ÖNCE) YAZ — İDEMPOTENT.
 *
 * Aynı `name` ile eskiden basılmış blok önce marker çiftinden silinir, sonra
 * (içerik boş değilse) apankorun hemen ardına/önüne yeniden yazılır. Böylece
 * betik kaç kez çalışırsa çalışsın dosyada tek kopya kalır.
 */
function injectBlock(html, { name, anchorRe, block, position = "after", requireAnchor = true }) {
  const markerStart = `<!-- ${name}:start -->`;
  const markerEnd = `<!-- ${name}:end -->`;
  // Baştaki `\n?` bir önceki çalıştırmanın araya koyduğu boş satırı da yutar
  // — yoksa her çalıştırma bir boş satır daha bırakır, dosya derleme
  // başına büyür (saatlik otomatik derlemede sessizce birikirdi).
  const blockRe = new RegExp(`\\n?[\\t ]*${markerStart}[\\s\\S]*?${markerEnd}\\n?`, "g");
  const stripped = html.replace(blockRe, "");

  if (!block) return { html: stripped, ok: true };

  if (!anchorRe.test(stripped)) {
    return { html: stripped, ok: !requireAnchor };
  }

  const wrapped = `        ${markerStart}${block}${markerEnd}\n`;
  const next = position === "after"
    ? stripped.replace(anchorRe, (match) => `${match}\n${wrapped}`)
    : stripped.replace(anchorRe, (match) => `${wrapped}\n${match}`);
  return { html: next, ok: true };
}

/**
 * BLOKLAR NEREYE GİRER.
 *
 * 1. `home-poll`      — hero bölümünün hemen ardına. Anket sayfanın ilk
 *    etkileşimi olmalı ama canlı skor kahramanının önüne geçmemeli. Mobilde
 *    ilk ekranda görünmesi CSS sırasıyla çözülüyor (`.home-poll { order: -1 }`).
 * 2. `poll-promo-matches` — "günün radar maçı" bölümünün ardına, yani maç
 *    önü vitrininin BİTTİĞİ ve "maç sonrası" bölümünün BAŞLADIĞI ara nokta.
 * 3. `poll-promo-transfer` — transfer radarı bölümünün ardına: hızlı gezinme
 *    (puan durumu bağlantısını taşıyor), transfer radarı ve gündem/haber
 *    akışı üçlüsünün TAM ORTASI.
 * 4. `poll-sticky` — alt bilginin (`</footer>`) hemen ardına, `</body>`'den
 *    ÖNCE değil: `</body>`'nin hemen önü sabit bir apankor değil (orada başka
 *    içerik olabilir/olmayabilir), `</footer>` sayfada tek ve her zaman var.
 *    `position: fixed` olduğu için DOM sırası görünürlüğü etkilemez;
 *    görünürlüğü istemci yönetir.
 */
const HERO_END_RE = /(<section class="container hero" id="hero-canli-skor"[\s\S]*?<\/section>\n)/;
const RADAR_MATCH_END_RE = /(<section class="container section home-radar-matches" id="gunun-radar-maci"[\s\S]*?<\/section>\n)/;
const TRANSFER_WATCH_END_RE = /(<section class="container section home-transfer-watch" id="transfer-izleme-paneli"[\s\S]*?<\/section>\n)/;
const FOOTER_END_RE = /(<\/footer>\n)/;

const selection = selectHomePoll({
  polls: readJson("data/home-polls.json") || {},
  teams: readJson("data/teams.json") || []
});
logRejected(selection.rejected);

const poll = selection.poll ? localizePoll(selection.poll, "tr") : null;
const homePollHtml = poll ? homePollBlock(poll, { locale: "tr", status: selection.status }) : "";
const promoHtml = poll ? pollPromoCardHtml(poll, { locale: "tr", status: selection.status }) : "";
const stickyHtml = poll ? pollStickyWidgetHtml(poll, { locale: "tr", status: selection.status }) : "";

const problems = [];
let updated = 0;

for (const file of targetsFor("index.html")) {
  const original = fs.readFileSync(file, "utf8");
  let html = original;
  let failed = false;

  const steps = [
    { name: "home-poll", anchorRe: HERO_END_RE, block: homePollHtml, position: "after" },
    { name: "poll-promo-matches", anchorRe: RADAR_MATCH_END_RE, block: promoHtml, position: "after" },
    { name: "poll-promo-transfer", anchorRe: TRANSFER_WATCH_END_RE, block: promoHtml, position: "after" },
    { name: "poll-sticky", anchorRe: FOOTER_END_RE, block: stickyHtml, position: "after" }
  ];

  for (const step of steps) {
    const result = injectBlock(html, step);
    html = result.html;
    if (!result.ok) {
      problems.push(`${path.relative(root, file)}: "${step.name}" apankoru bulunamadı, blok yazılamadı`);
      failed = true;
    }
  }

  if (failed) continue;
  if (html === original) continue;
  if (CHECK_ONLY) {
    problems.push(`${path.relative(root, file)}: anket blokları güncel değil`);
    continue;
  }
  fs.writeFileSync(file, html, "utf8");
  updated += 1;
}

if (problems.length) {
  console.error("home-poll injection FAILED:");
  problems.forEach((line) => console.error(`  - ${line}`));
  process.exitCode = 1;
} else if (CHECK_ONLY) {
  console.log("home-poll: anket blokları güncel.");
} else {
  console.log(
    poll
      ? `home-poll: "${poll.question}" (${selection.status}) — ${updated} dosya güncellendi.`
      : `home-poll: yayında anket yok, bloklar basılmadı (${updated} dosya güncellendi).`
  );
}
