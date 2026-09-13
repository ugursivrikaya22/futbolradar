/**
 * CANLI PUAN DURUMU — GERÇEK TARAYICI TESTİ.
 *
 * Birim testleri aritmetiği doğruluyor; bu test SAYFANIN KENDİSİNİ
 * doğruluyor: gerçek `super-lig-puan-durumu.html`, gerçek `site.js` ve
 * gerçek `data-refresh.js` bir tarayıcıda çalışırken, sunucudan gelen
 * canlı skor paketi tabloyu SAYFA YENİLENMEDEN değiştiriyor mu?
 *
 * Görev tanımındaki senaryo adım adım sürülüyor: 1-0 → 1-1 → 1-2. Her
 * adımda puanların ve SIRALAMANIN doğru değiştiği, "CANLI" rozetinin
 * yalnızca etkilenen satırlarda çıktığı ve maç resmî tabloya girdiğinde
 * puanın İKİ KEZ sayılmadığı kontrol ediliyor.
 *
 * Sağlayıcıya hiç çıkılmıyor: bu betik hem duran dosyaları hem de sahte
 * `/api/standings` ve `/api/live-score-stream` uçlarını kendisi servis
 * ediyor, böylece skor akışının zamanlaması testin elinde.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const root = process.cwd();
const PORT = Number(process.env.LIVE_STANDINGS_PORT || 4191);
const base = `http://127.0.0.1:${PORT}`;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

/** Sahte resmî tablo. Üç takım da 3 puanda; sıralamayı yalnızca resmî sıra ayırıyor. */
function officialRows(absorbed) {
  const team = (id, name, rank, extra) => Object.assign({
    id: String(id),
    name,
    team: name,
    logo: `https://media.api-sports.io/football/teams/${id}.png`,
    rank,
    played: 1,
    won: 1,
    drawn: 0,
    lost: 0,
    goalsFor: 2,
    goalsAgainst: 1,
    goalDifference: 1,
    points: 3
  }, extra || {});

  if (!absorbed) {
    return [team(10, "Ev Sahibi FK", 1), team(20, "Deplasman SK", 2), team(30, "Üçüncü Takım", 3)];
  }
  // Sağlayıcı 1-2 biten maçı tabloya işledi.
  return [
    team(20, "Deplasman SK", 1, { played: 2, won: 2, goalsFor: 4, goalsAgainst: 2, goalDifference: 2, points: 6 }),
    team(30, "Üçüncü Takım", 2),
    team(10, "Ev Sahibi FK", 3, { played: 2, won: 1, lost: 1, goalsFor: 3, goalsAgainst: 3, goalDifference: 0, points: 3 })
  ];
}

function liveMatch(home, away, status) {
  return {
    id: "test-mac-1",
    providerId: "test-mac-1",
    competitionId: "super-lig",
    league: "Süper Lig",
    homeTeam: "Ev Sahibi FK",
    awayTeam: "Deplasman SK",
    homeTeamId: "10",
    awayTeamId: "20",
    homeTeamLogo: "https://media.api-sports.io/football/teams/10.png",
    awayTeamLogo: "https://media.api-sports.io/football/teams/20.png",
    status: status === "FT" ? "FINISHED" : "LIVE",
    providerStatus: status || "2H",
    live: status !== "FT",
    minute: 70,
    score: { home, away },
    events: []
  };
}

const state = { absorbed: false, matches: [] };
const clients = new Set();

function broadcast() {
  const payload = JSON.stringify({ id: `p${Date.now()}`, matches: state.matches, timing: {} });
  for (const res of clients) {
    res.write("event: snapshot\n");
    res.write(`data: ${payload}\n\n`);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, base);

  if (url.pathname === "/api/standings") {
    res.writeHead(200, { "content-type": TYPES[".json"], "cache-control": "no-store" });
    return res.end(JSON.stringify({ ok: true, data: officialRows(state.absorbed), updatedAt: new Date().toISOString() }));
  }

  if (url.pathname === "/api/live-score-stream") {
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" });
    res.write(": bagli\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    res.writeHead(200, { "content-type": TYPES[".json"] });
    return res.end(JSON.stringify({ ok: true, data: [] }));
  }

  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  const file = path.join(root, relative);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "content-type": TYPES[".html"] });
    return res.end("yok");
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  return res.end(fs.readFileSync(file));
});

const checks = [];
function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition) });
  assert.ok(condition, `${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`  ok  ${name}`);
}

/** Tablodaki satırları okur: sıra, ad, O, G, B, M, A, Y, AV, P ve canlı işareti. */
async function readTable(page) {
  return page.$$eval(".evergreen-table tbody tr", (rows) => rows.map((row) => {
    const cells = Array.from(row.querySelectorAll("td, th")).map((cell) => cell.textContent.trim());
    return {
      rank: Number(cells[0]),
      name: cells[1].replace(/(CANLI|LIVE)$/, "").trim(),
      played: Number(cells[2]),
      won: Number(cells[3]),
      drawn: Number(cells[4]),
      lost: Number(cells[5]),
      goalsFor: Number(cells[6]),
      goalsAgainst: Number(cells[7]),
      goalDifference: Number(cells[8]),
      points: Number(cells[9]),
      live: row.getAttribute("data-standings-live") === "true",
      badge: Boolean(row.querySelector(".standings-live-badge"))
    };
  }));
}

async function waitFor(page, predicate, message, timeout = 10000) {
  const end = Date.now() + timeout;
  for (;;) {
    const rows = await readTable(page);
    if (predicate(rows)) return rows;
    if (Date.now() > end) assert.fail(`${message} (son durum: ${JSON.stringify(rows)})`);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}

function find(rows, name) {
  return rows.filter((row) => row.name === name)[0];
}

(async () => {
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {})
  });

  /**
   * Sürülecek yüzeyler. Türkçe sayfa iki genişlikte, İngilizce sayfa
   * mobilde: dil seçimi genişlikten bağımsız, bu yüzden İngilizce tarafı
   * her genişlikte tekrarlamak koşu süresini boşuna ikiye katlardı.
   */
  const TARGETS = [
    { path: "/super-lig-puan-durumu.html", viewport: { width: 1280, height: 900 }, badge: "CANLI", lang: "tr" },
    { path: "/super-lig-puan-durumu.html", viewport: { width: 390, height: 844 }, badge: "CANLI", lang: "tr" },
    { path: "/en/super-lig-standings.html", viewport: { width: 390, height: 844 }, badge: "LIVE", lang: "en" }
  ];

  try {
    for (const target of TARGETS) {
      const viewport = target.viewport;
      const context = await browser.newContext({ viewport, serviceWorkers: "block" });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on("pageerror", (error) => consoleErrors.push(String(error)));
      page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

      const label = `${target.lang}/${viewport.width}px`;
      state.absorbed = false;
      state.matches = [];

      await page.goto(`${base}${target.path}`, { waitUntil: "domcontentloaded" });
      check(`${label} sayfanın dili ${target.lang}`, await page.evaluate(() => document.documentElement.lang) === target.lang);

      // 1) Resmî tablo: canlı maç yokken hiçbir satır canlı işaretli olmamalı.
      let rows = await waitFor(page, (list) => list.length === 3 && find(list, "Ev Sahibi FK"), `${label} resmî tablo çizilmeli`);
      check(`${label} resmî tablo üç satırla çizilir`, rows.length === 3);
      check(`${label} canlı maç yokken rozet yok`, rows.every((row) => !row.badge));

      const navigations = [];
      page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations.push(frame.url()); });

      // 2) 1-0
      state.matches = [liveMatch(1, 0)];
      broadcast();
      rows = await waitFor(page, (list) => (find(list, "Ev Sahibi FK") || {}).points === 6, `${label} 1-0 sonrası ev sahibi 6 puana çıkmalı`);
      let home = find(rows, "Ev Sahibi FK");
      let away = find(rows, "Deplasman SK");
      check(`${label} 1-0: ev sahibi 6 puan`, home.points === 6);
      check(`${label} 1-0: ev sahibi zirvede`, home.rank === 1);
      check(`${label} 1-0: oynanan maç 2, galibiyet 2`, home.played === 2 && home.won === 2);
      check(`${label} 1-0: atılan/yenen gol ve averaj doğru`, home.goalsFor === 3 && home.goalsAgainst === 1 && home.goalDifference === 2);
      check(`${label} 1-0: rakip 3 puanda kalır ve geriler`, away.points === 3 && away.lost === 1 && away.rank === 3);
      check(`${label} 1-0: yalnızca maçtaki takımlar canlı işaretli`, home.badge && away.badge && !find(rows, "Üçüncü Takım").badge);
      const badgeText = await page.$eval(".standings-live-badge", (node) => node.textContent.trim());
      check(`${label} rozet metni "${target.badge}"`, badgeText === target.badge, badgeText);

      // 3) 1-1
      state.matches = [liveMatch(1, 1)];
      broadcast();
      rows = await waitFor(page, (list) => (find(list, "Ev Sahibi FK") || {}).points === 4, `${label} 1-1 sonrası iki takım da 4 puan olmalı`);
      home = find(rows, "Ev Sahibi FK");
      away = find(rows, "Deplasman SK");
      check(`${label} 1-1: iki takım da 4 puan`, home.points === 4 && away.points === 4);
      check(`${label} 1-1: beraberlik sayısı 1`, home.drawn === 1 && away.drawn === 1);
      check(`${label} 1-1: ikisi de üçüncü takımın üstünde`, home.rank === 1 && away.rank === 2 && find(rows, "Üçüncü Takım").rank === 3);

      // 4) 1-2
      state.matches = [liveMatch(1, 2)];
      broadcast();
      rows = await waitFor(page, (list) => (find(list, "Deplasman SK") || {}).points === 6, `${label} 1-2 sonrası deplasman 6 puana çıkmalı`);
      home = find(rows, "Ev Sahibi FK");
      away = find(rows, "Deplasman SK");
      check(`${label} 1-2: deplasman 6 puan ve zirvede`, away.points === 6 && away.rank === 1);
      check(`${label} 1-2: deplasman averajı +2`, away.goalDifference === 2 && away.goalsFor === 4);
      check(`${label} 1-2: ev sahibi 3 puanda ve üçüncü`, home.points === 3 && home.lost === 1 && home.rank === 3);
      check(`${label} 1-2: sıra numaraları tekil`, new Set(rows.map((row) => row.rank)).size === rows.length);

      // 5) Maç bitti, resmî tablo henüz saymadı: geçici etki KORUNUR.
      state.matches = [liveMatch(1, 2, "FT")];
      broadcast();
      await new Promise((resolve) => setTimeout(resolve, 300));
      rows = await readTable(page);
      check(`${label} maç bitince tablo geri gitmez`, find(rows, "Deplasman SK").points === 6);

      // 6) Resmî tablo maçı saydı: geçici etki bırakılır, puan iki kez sayılmaz.
      state.absorbed = true;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      rows = await waitFor(page, (list) => list.every((row) => !row.badge), `${label} resmî tablo gelince rozet düşmeli`, 15000);
      away = find(rows, "Deplasman SK");
      check(`${label} resmî sonuç: puan iki kez sayılmaz`, away.points === 6 && away.played === 2);
      check(`${label} resmî sonuç: canlı işareti kalkar`, rows.every((row) => !row.badge));

      // 7) Sayfa hiç yeniden yüklenmedi ve konsol temiz.
      check(`${label} tablo sayfa yenilenmeden güncellendi`, navigations.length === 0, navigations.join(", "));
      check(`${label} konsol hatası yok`, consoleErrors.length === 0, consoleErrors.join(" | "));

      // 8) Mobilde tablo yatay taşma üretmiyor.
      if (viewport.width <= 480) {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        check(`${label} sayfa yatay taşmıyor`, overflow <= 1, `taşma ${overflow}px`);
      }

      await context.close();
    }
  } finally {
    await browser.close();
    // AÇIK SSE BAĞLANTISI DERLEMEYİ ASMASIN.
    //
    // `server.close()` yalnızca yeni bağlantıyı durdurur ve açık olanların
    // kapanmasını BEKLER. Canlı skor akışı tanımı gereği açık kalan bir
    // bağlantı: tarayıcı kapanırken bir soket geride kalırsa kapanış hiç
    // çözülmez ve bu kapı, üretim derlemesini süresiz bekletir. Bağlantılar
    // açıkça kesiliyor ve sunucu süreci canlı tutmayacak biçimde
    // işaretleniyor.
    for (const res of clients) { try { res.end(); } catch (error) { /* zaten kapandı */ } }
    clients.clear();
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    server.unref();
    await new Promise((resolve) => server.close(() => resolve()));
  }

  console.log(`\nCanlı puan durumu tarayıcı testi geçti (${checks.length} kontrol)`);
  // Geride kalan bir soket ya da tarayıcı süreci olay döngüsünü açık
  // tutmasın: kapı sonucunu bildirdikten sonra kesin olarak biter.
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

// SON ÇARE ZAMAN AŞIMI. Bir kapının kendisi derlemeyi asmamalı; bu testin
// tamamı yerelde bir dakikanın altında koşuyor, dört dakika fazlasıyla
// yeterli bir üst sınır.
const HARD_TIMEOUT_MS = 4 * 60 * 1000;
setTimeout(() => {
  console.error(`[live-standings-browser] ${HARD_TIMEOUT_MS / 1000} saniyede tamamlanmadı; kapı durduruluyor.`);
  process.exit(1);
}, HARD_TIMEOUT_MS).unref();
