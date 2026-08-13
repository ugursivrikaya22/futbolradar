/**
 * MAÇ LİSTESİ PENCERESİ TESTLERİ
 *
 * Pencerenin sözleşmesi üç cümle:
 *
 *   1. Başlangıçta en fazla MATCH_LIST_INITIAL kart görünür.
 *   2. Daha fazlası VARSA buton basılır; YOKSA hiç basılmaz. Ölü bir buton,
 *      arkasında içerik olduğunu vaat edip boş açılır.
 *   3. Eksik kart YER TUTUCU ile doldurulmaz. On iki hedeftir, kota değil;
 *      elde üç maç varsa üç kart görünür ve sahte kart üretilmez.
 *
 * Ayrıca istemci (app.js) ile ön derleme (services/matchListWindow.js) aynı
 * sayıyı kullanmak ZORUNDA: ayrışırlarsa statik yedek altı kart basar,
 * JavaScript on ikiye çıkarır ve sayfa yüklenirken zıplar.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const { MATCH_LIST_INITIAL, splitMatchWindow } = require("../services/matchListWindow.js");

const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const cssSource = fs.readFileSync(path.join(root, "page.css"), "utf8");
const prerenderSource = fs.readFileSync(path.join(root, "scripts", "prerender-core-pages.mjs"), "utf8");

function matches(count, prefix) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix || "mac"}-${index}`,
    homeTeam: `Ev ${index}`,
    awayTeam: `Deplasman ${index}`
  }));
}

// ── 1. Pencere boyutu ──────────────────────────────────────────────────────
{
  assert.equal(MATCH_LIST_INITIAL, 12, "başlangıç penceresi 12 kart olmalı");
}

// ── 2. İstemci ile ön derleme ayrışmamalı ──────────────────────────────────
//
// Bu testin varlık sebebi: sayı iki yerde yazılı ve biri değiştirilip diğeri
// unutulduğunda hata sessizdir — sayfa çalışır, sadece yüklenirken zıplar.
{
  const block = appSource.match(/\/\/ match-list-window:start([\s\S]*?)\/\/ match-list-window:end/);
  assert.ok(block, "app.js içinde match-list-window bloğu bulunmalı");

  const declared = block[1].match(/var\s+MATCH_LIST_INITIAL\s*=\s*(\d+)\s*;/);
  assert.ok(declared, "app.js MATCH_LIST_INITIAL sabitini tanımlamalı");
  assert.equal(
    Number(declared[1]),
    MATCH_LIST_INITIAL,
    "app.js ile services/matchListWindow.js aynı pencereyi kullanmalı"
  );

  // Ön derleme sabiti ELLE yazmamalı, paylaşılan modülden almalı.
  assert.ok(
    prerenderSource.includes('require("../services/matchListWindow.js")'),
    "prerender paylaşılan pencere modülünü içe aktarmalı"
  );
  assert.ok(
    /calendarProgramCards\(MATCH_LIST_INITIAL\)/.test(prerenderSource),
    "prerender statik yedeği paylaşılan pencereyle üretmeli"
  );
  assert.ok(
    !/calendarProgramCards\(variant === "today" \? 6 : 4\)/.test(prerenderSource),
    "prerender'daki eski 6/4 kart ayrımı kalmamalı"
  );
}

// ── 3. Bölme: görünen / gizli ──────────────────────────────────────────────
{
  const full = splitMatchWindow(matches(20));
  assert.equal(full.visible.length, MATCH_LIST_INITIAL, "ilk pencere tam dolmalı");
  assert.equal(full.hiddenCount, 8, "kalan 8 maç gizli sayılmalı");
  assert.equal(full.hasMore, true, "12'den fazla maçta buton gerekli");

  const exact = splitMatchWindow(matches(MATCH_LIST_INITIAL));
  assert.equal(exact.visible.length, MATCH_LIST_INITIAL);
  assert.equal(exact.hasMore, false, "tam 12 maçta buton basılmamalı");
}

// ── 4. VERİ AZSA YER TUTUCU YOK ────────────────────────────────────────────
//
// "12 hedef, ama veri 12'den azsa boş kutu ya da sahte maç gösterme."
{
  for (const count of [0, 1, 3, 11]) {
    const window = splitMatchWindow(matches(count));
    assert.equal(window.visible.length, count, `${count} maçta ${count} kart görünmeli`);
    assert.equal(window.hiddenCount, 0, `${count} maçta gizlenecek kart olmamalı`);
    assert.equal(window.hasMore, false, `${count} maçta buton basılmamalı`);
  }

  // Bozuk girdi de kart uydurmamalı.
  for (const input of [null, undefined, "12", {}]) {
    const window = splitMatchWindow(input);
    assert.equal(window.visible.length, 0, "geçersiz girdiden kart üretilmemeli");
    assert.equal(window.hasMore, false);
  }
}

// ── 5. İstemci penceresi: buton yalnızca gerektiğinde ──────────────────────
//
// app.js'in gerçek işaretleme üreticisi izole edilip çalıştırılıyor: kural
// katmanını sınamak yetmez, ekrana basılan şeyi de sınamak gerekir.
{
  const block = appSource.match(/\/\/ match-list-window:start([\s\S]*?)\/\/ match-list-window:end/)[1];

  const client = new Function(`
    "use strict";
    function escapeHtml(value) {
      return String(value === null || value === undefined ? "" : value)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    ${block}
    return {
      MATCH_LIST_INITIAL: MATCH_LIST_INITIAL,
      renderMatchListWindow: renderMatchListWindow,
      markMatchOverflow: markMatchOverflow,
      expandedMatchLists: expandedMatchLists
    };
  `)();

  const card = (match) => `<article class="fixture-card" data-match="${match.id}"></article>`;
  const countCards = (html) => (html.match(/<article/g) || []).length;
  const countHidden = (html) => (html.match(/data-match-overflow/g) || []).length;

  // 20 maç: 20 kart basılır, 8'i gizli, buton var ve sayıyı söyler.
  const many = client.renderMatchListWindow(matches(20), card, "test-many");
  assert.equal(countCards(many), 20, "kartlar silinmemeli, gizlenmeli");
  assert.equal(countHidden(many), 8, "12'den sonrası gizli işaretlenmeli");
  assert.ok(many.includes('data-match-more="test-many"'), "buton basılmalı");
  assert.ok(many.includes("+8 maç"), "buton kaç maç gizlendiğini söylemeli");
  assert.ok(many.includes('aria-expanded="false"'), "buton kapalı durumu bildirmeli");

  // 12 ve altı: buton HİÇ basılmaz.
  for (const count of [0, 1, 11, 12]) {
    const html = client.renderMatchListWindow(matches(count), card, `test-${count}`);
    assert.equal(countCards(html), count, `${count} maçta ${count} kart basılmalı`);
    assert.equal(countHidden(html), 0, `${count} maçta gizli kart olmamalı`);
    assert.ok(!html.includes("data-match-more"), `${count} maçta buton basılmamalı`);
    assert.ok(!html.includes("match-more-row"), `${count} maçta buton satırı olmamalı`);
  }

  // Genişletilmiş liste: gizli kart kalmaz, buton "Daha Az Göster" der.
  client.expandedMatchLists["test-open"] = true;
  const opened = client.renderMatchListWindow(matches(20), card, "test-open");
  assert.equal(countHidden(opened), 0, "açık listede gizli kart kalmamalı");
  assert.ok(opened.includes('aria-expanded="true"'), "açık liste durumu bildirmeli");
  assert.ok(opened.includes("Daha Az Göster"), "açık listede geri kapatma etiketi olmalı");

  // GENİŞLETME ÇİZİMDEN BAĞIMSIZ. Canlı yoklama beş dakikada bir innerHTML'i
  // baştan yazıyor; durum DOM'da tutulsaydı kullanıcının açtığı liste
  // kendiliğinden kapanırdı.
  const reRendered = client.renderMatchListWindow(matches(20), card, "test-open");
  assert.equal(countHidden(reRendered), 0, "yeniden çizim genişletmeyi sıfırlamamalı");

  // Gizleme işareti kartın KÖK etiketine basılmalı; iç öğeye kaçarsa kart
  // görünür kalır ve pencere hiç çalışmaz.
  const stamped = client.markMatchOverflow('<article class="fixture-card"><div>x</div></article>');
  assert.ok(
    /^<article hidden data-match-overflow class="fixture-card"/.test(stamped),
    `gizleme işareti kök etikete basılmalı, üretilen: ${stamped}`
  );

  // Lig bloklarında da pencere toplam kart sayısına göre işler.
  const grouped = client.renderMatchListWindow(
    matches(18),
    card,
    "test-grouped",
    (list, renderer) => `<section>${list.map(renderer).join("")}</section>`
  );
  assert.equal(countCards(grouped), 18, "gruplu çizimde tüm kartlar basılmalı");
  assert.equal(countHidden(grouped), 6, "gruplu çizimde de 12'den sonrası gizlenmeli");
}

// ── 6. Gizli kart GERÇEKTEN gizlenmeli ─────────────────────────────────────
//
// `[hidden]` tek başına yetmiyor: kartlar `display: grid` taşıyor ve bu,
// tarayıcının `[hidden] { display: none }` varsayılanını geçersiz kılıyor.
// Kural olmadan "gizli" kartlar ekranda kalırdı.
{
  assert.ok(
    /\.fixture-card\[hidden\][\s\S]{0,80}display:\s*none/.test(cssSource),
    "page.css gizli maç kartını display:none yapmalı"
  );
  // Kompakt kart display:grid taşıyor; [hidden] tek başına onu yenemez.
  assert.ok(
    /\.live-compact-card\[hidden\][\s\S]{0,80}display:\s*none/.test(cssSource),
    "page.css gizli kompakt canlı skor satırını display:none yapmalı"
  );
  assert.ok(
    /\.match-more-row\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1/.test(cssSource),
    "buton satırı ızgarada tüm satırı kaplamalı, yoksa kart hücresine sıkışır"
  );
}

// ── 7. Kompakt kart: logo ve skor korunmalı ────────────────────────────────
//
// Sıkıştırma okunabilirliği yemeyecek. Logo sütunu 26px ve skor --fs-md/800
// BİLEREK dokunulmadı; bu test onları kilitler.
{
  const fixtureRow = cssSource.match(/\.fixture-row\s*\{[\s\S]*?\}/);
  assert.ok(fixtureRow, ".fixture-row kuralı bulunmalı");
  assert.ok(
    /grid-template-columns:\s*26px/.test(fixtureRow[0]),
    "takım logosu sütunu 26px kalmalı — bundan küçükte rozet tanınmıyor"
  );

  const score = cssSource.match(/\.fixture-row-score\s*\{[\s\S]*?\}/);
  assert.ok(score, ".fixture-row-score kuralı bulunmalı");
  assert.ok(/font-size:\s*var\(--fs-md\)/.test(score[0]), "skor tipografisi küçültülmemeli");
  assert.ok(/font-weight:\s*800/.test(score[0]), "skor kalınlığı korunmalı");

  // Izgara gerçekten sıklaşmış olmalı.
  assert.ok(
    /\.matches-grid,\s*\n\.league-match-grid\s*\{\s*\n\s*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(228px/.test(cssSource),
    "maç ızgarası 228px tabanına inmeli"
  );

  // Canlı skor alanı artık kompakt panoyu kullanıyor (skoru olmayan maç
  // alana hiç girmez, satırlar tek çizgilik). Panonun kendi sıkı ızgarası
  // olmalı; genel maç ızgarasına geri düşerse kompakt satırlar geniş kart
  // boşluklarıyla seyrelir.
  assert.ok(
    /\.live-compact-board \.league-match-grid\s*\{[\s\S]{0,200}?minmax\(min\(100%, 270px\)/.test(cssSource),
    "kompakt canlı skor panosunun sıkı ızgarası (270px taban, 6px boşluk) korunmalı"
  );
}

// ── 8. Dokunmatik hedef korunmalı ──────────────────────────────────────────
//
// Kart eylem düğmesi yalnızca fare kullanılan genişliklerde alçalır; dokunmatik
// alt sınırı (--tap) küçük ekranlarda geçerli kalır.
{
  assert.ok(
    /@media \(min-width: 761px\)\s*\{\s*\n\s*\.fixture-card-action\s*\{\s*\n\s*min-height:\s*34px/.test(cssSource),
    "eylem düğmesi yalnızca masaüstünde alçalmalı"
  );

  const action = cssSource.match(/\.fixture-card-action\s*\{[\s\S]*?\}/);
  assert.ok(/min-height:\s*var\(--tap\)/.test(action[0]), "taban kural dokunmatik hedefi korumalı");

  const moreButton = cssSource.match(/\.match-more\s*\{[\s\S]*?\}/);
  assert.ok(moreButton, ".match-more kuralı bulunmalı");
  assert.ok(
    /min-height:\s*var\(--tap\)/.test(moreButton[0]),
    "Daha Fazla Göster düğmesi dokunmatik hedef sınırını karşılamalı"
  );
}

console.log(
  `Maç listesi penceresi testleri geçti (pencere=${MATCH_LIST_INITIAL}, ` +
  "istemci-ön derleme eşliği, yer tutucu yasağı, buton koşulu, genişletme kalıcılığı, logo/skor koruması)."
);
