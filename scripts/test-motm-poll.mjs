#!/usr/bin/env node
/**
 * MAÇIN ADAMI ANKETİ — SÖZLEŞME DENETİMİ.
 *
 * Anket bir okuyucu etkileşimi ama seçenek listesi bir VERİ İDDİASIDIR:
 * ekrana bir futbolcu adı bastığımız anda "bu oyuncu bu maçta oynadı"
 * demiş oluyoruz. Testler bu iddiayı iki yönden sıkıştırıyor:
 *
 *   • Listeye girmemesi gereken kim girebilir? (kulübede kalan yedek,
 *     kadro listesinden gelen isim, başka maçın oyuncusu)
 *   • Anket çıkmaması gereken yerde çıkabilir mi? (yabancı-yabancı maç,
 *     oynanmamış maç, kadrosuz maç)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { motmPollBlock } from "./lib/motmPoll.mjs";

const require = createRequire(import.meta.url);
const {
  COPY,
  MATCH_DURATION_APPROX_MS,
  VOTING_WINDOW_AFTER_MATCH_MS,
  buildMotmPoll,
  isFinished,
  hasTurkishSide,
  isVotingOpen,
  playedPlayers,
  votingClosesAtMs
} = require("../services/motmPoll.js");

const root = process.cwd();

const match = (overrides = {}) => ({
  id: "test-mac-2026-01-01",
  status: "FINISHED",
  homeTeam: "Beşiktaş",
  awayTeam: "FC Midtjylland",
  lineups: [
    { team: "Beşiktaş", players: ["Mert Günok", "Gedson Fernandes"], substitutes: ["Kulübedeki Oyuncu"] },
    { team: "FC Midtjylland", players: ["A. Bir", "B. İki"], substitutes: ["C. Üç"] }
  ],
  substitutions: [{ time: "60'", team: "Beşiktaş", in: "Oyuna Giren", out: "Mert Günok" }],
  ...overrides
});

console.log("motm-poll");

// ── 1. YEDEK KULÜBESİ LİSTEYE GİRMEZ ───────────────────────────────────────
//
// Bu testin tek başına var oluş nedeni var: "starters plus subs" ifadesini
// `lineups[].substitutes` diye okumak, kulübede oturup hiç oynamamış bir
// futbolcuyu maçın adamı adayı yapardı. Okuyucu listede gördüğü adı oynamış
// sayar — yani sessiz bir uydurma olurdu.
{
  const names = playedPlayers(match()).map((option) => option.name);
  assert.ok(names.includes("Mert Günok"), "ilk onbir listede olmalı");
  assert.ok(names.includes("Oyuna Giren"), "oyuna giren yedek listede olmalı");
  assert.ok(!names.includes("Kulübedeki Oyuncu"), "kulübede kalan yedek listeye GİRMEMELİ");
  assert.ok(!names.includes("C. Üç"), "rakip kulübesi de listeye girmemeli");

  const roles = Object.fromEntries(playedPlayers(match()).map((o) => [o.name, o.role]));
  assert.equal(roles["Mert Günok"], "starter");
  assert.equal(roles["Oyuna Giren"], "substitute");
}

// ── 2. Yabancı-yabancı maçta anket YOK ─────────────────────────────────────
{
  const foreign = buildMotmPoll(match({ homeTeam: "Arsenal", awayTeam: "FC Midtjylland" }));
  assert.equal(foreign.poll, null, "iki yabancı kulüplü maçta anket olmamalı");
  assert.match(foreign.skipReason, /Türk kulübü yok/);

  // Tek Türk kulübü yeter — deplasmanda da olsa.
  assert.ok(buildMotmPoll(match({ homeTeam: "Arsenal", awayTeam: "Galatasaray" })).poll);
  assert.equal(hasTurkishSide({ homeTeam: "Arsenal", awayTeam: "Real Madrid" }), false);
}

// ── 3. Oynanmamış maçta anket YOK ──────────────────────────────────────────
//
// "Maçın adamı" oynanmış bir maç hakkında bir yargıdır.
{
  for (const status of ["NS", "SCHEDULED", "1H", "LIVE", "POSTPONED"]) {
    const result = buildMotmPoll(match({ status }));
    assert.equal(result.poll, null, `${status}: bitmemiş maçta anket olmamalı`);
  }
  assert.equal(isFinished({ status: "FINISHED" }), true);
  assert.equal(isFinished({ status: "FT" }), true);
  assert.equal(isFinished({ status: "1H" }), false);
}

// ── 4. Kadro verisi yoksa anket YOK — isim UYDURULMAZ ──────────────────────
{
  assert.equal(buildMotmPoll(match({ lineups: [], substitutions: [] })).poll, null);
  assert.equal(buildMotmPoll(match({ lineups: undefined, substitutions: undefined })).poll, null);

  // Tek adaylı anket anket değildir.
  const single = buildMotmPoll(match({
    lineups: [{ team: "Beşiktaş", players: ["Tek Oyuncu"] }],
    substitutions: []
  }));
  assert.equal(single.poll, null, "tek seçenekli oylama basılmamalı");
  assert.match(single.skipReason, /kadro verisi yok/);

  // Kulübe DOLU ama sahada kimse yoksa yine anket yok: kulübe oynamış
  // saymaz, dolayısıyla aday üretmez.
  const benchOnly = buildMotmPoll(match({
    lineups: [{ team: "Beşiktaş", players: [], substitutes: ["A", "B", "C"] }],
    substitutions: []
  }));
  assert.equal(benchOnly.poll, null, "yalnızca kulübe varsa anket olmamalı");
}

// ── 5. Aynı oyuncu iki kez listeye girmez ──────────────────────────────────
{
  const options = playedPlayers(match({
    substitutions: [{ team: "Beşiktaş", in: "Mert Günok", out: "Gedson Fernandes" }]
  }));
  const names = options.map((option) => option.name);
  assert.equal(names.filter((name) => name === "Mert Günok").length, 1, "aday listede yinelenmemeli");
  // İlk onbir rolü korunur.
  assert.equal(options.find((option) => option.name === "Mert Günok").role, "starter");
}

// ── 6. Metinler gereksinimde verilen cümlelerin BİREBİR aynısı ─────────────
{
  assert.equal(COPY.title, "Maçın Adamını Seç!");
  assert.equal(COPY.subtitle, "Sence bu maçın yıldızı kimdi? Oyunu ver, sonucu hemen gör.");
  assert.equal(COPY.button, "Oy Ver");
  assert.equal(COPY.thanks, "Teşekkürler! Güncel sonuçlar aşağıda.");
}

// ── 7. İşaretleme ──────────────────────────────────────────────────────────
{
  const { poll } = buildMotmPoll(match());
  const html = motmPollBlock(poll);

  // BLOK `hidden` DOĞAR. JavaScript yoksa basınca hiçbir şey yapmayan bir
  // "Oy Ver" düğmesi göstermek, kullanıcıya olmayan bir söz vermektir.
  assert.match(html, /<section class="motm-poll"[^>]*\shidden>/, "anket hidden doğmalı");

  assert.ok(html.includes(COPY.title));
  assert.ok(html.includes(COPY.subtitle));
  assert.ok(html.includes(COPY.button));
  assert.ok(html.includes(COPY.thanks));
  assert.ok(html.includes(COPY.localNote), "sonucun cihaz-yerel olduğu yazılı olmalı");

  // Erişilebilirlik: başlık bağlantısı ve tekil radyo grubu.
  assert.match(html, /aria-labelledby="motm-title-test-mac-2026-01-01"/);
  assert.match(html, /name="motm-test-mac-2026-01-01"/);

  // Anket YAPILANDIRILMIŞ VERİ DEĞİL: JSON-LD basılmamalı.
  assert.ok(!/application\/ld\+json/.test(html), "anket JSON-LD bildirmemeli");

  // Anketsiz maçta blok boş.
  assert.equal(motmPollBlock(null), "");
  assert.equal(motmPollBlock({ matchId: "x", options: [{ id: "a", name: "A" }] }), "",
    "tek seçenekli anket çizilmemeli");
}

// ── 8. Kaçış: oyuncu adı işaretlemeyi kıramaz ──────────────────────────────
{
  const { poll } = buildMotmPoll(match({
    lineups: [{ team: "Beşiktaş", players: ['<img src=x onerror="alert(1)">', "İkinci Oyuncu"] }],
    substitutions: []
  }));
  const html = motmPollBlock(poll);
  assert.ok(!html.includes("<img"), "veri ham HTML olarak basılmamalı");
  assert.ok(html.includes("&lt;img"), "veri kaçırılmış olmalı");
}

// ── 9. İstemci sözleşmesi: site.js anketi tanıyor ──────────────────────────
//
// İşaretleme ile istemcinin bağlandığı kancalar ayrı dosyalarda; biri
// yeniden adlandırılırsa anket sessizce ölür (blok `hidden` doğduğu için
// EKRANDA HİÇ GÖRÜNMEZ — yani hata gözle fark edilmez).
{
  const client = fs.readFileSync(path.join(root, "site.js"), "utf8");
  for (const hook of ["data-motm-poll", "data-motm-form", "data-motm-results", "data-motm-match", "motm-poll__radio"]) {
    assert.ok(client.includes(hook), `site.js "${hook}" kancasını kaybetmiş`);
  }
  assert.match(client, /poll\.hidden = false/, "istemci anketi açmalı");
  assert.match(client, /localStorage/, "oy cihazda saklanmalı");
  // Depo erişilemeyebilir (gizli sekme, kota); erişim korumalı olmalı.
  assert.match(client, /try\s*\{[\s\S]*localStorage/, "localStorage erişimi korumalı olmalı");
}

// ── 10. Gerçek veri: anket yalnızca hak eden maçlarda ──────────────────────
{
  const payload = JSON.parse(fs.readFileSync(path.join(root, "data", "matches.json"), "utf8"));
  const list = Array.isArray(payload) ? payload : (payload.matches || []);

  for (const record of list) {
    const { poll } = buildMotmPoll(record);
    if (!poll) continue;
    assert.ok(hasTurkishSide(record), `${record.id}: Türk kulübü olmayan maçta anket üretildi`);
    assert.ok(isFinished(record), `${record.id}: bitmemiş maçta anket üretildi`);
    assert.ok(poll.options.length >= 2, `${record.id}: iki adaydan az`);

    // Her aday GERÇEKTEN sahada mı? İlk onbir ya da oyuna giren olmalı.
    const played = new Set([
      ...(record.lineups || []).flatMap((side) => side.players || []),
      ...(record.substitutions || []).map((change) => change.in)
    ].filter(Boolean).map(String));
    for (const option of poll.options) {
      assert.ok(played.has(option.name), `${record.id}: "${option.name}" sahada değildi`);
    }
  }
}

// ── 11. Basılmış sayfalar: anket yalnızca hak eden sayfada ─────────────────
{
  const pages = [];
  for (const dir of ["mac", "mac-raporu", "analiz"]) {
    const absolute = path.join(root, dir);
    if (!fs.existsSync(absolute)) continue;
    for (const name of fs.readdirSync(absolute)) {
      if (name.endsWith(".html")) pages.push({ dir, name, file: path.join(absolute, name) });
    }
  }
  assert.ok(pages.length > 0, "denetlenecek maç sayfası bulunmalı");

  const payload = JSON.parse(fs.readFileSync(path.join(root, "data", "matches.json"), "utf8"));
  const list = Array.isArray(payload) ? payload : (payload.matches || []);
  const eligible = new Set(list.filter((record) => buildMotmPoll(record).poll).map((record) => record.id));

  let printed = 0;
  for (const page of pages) {
    const html = fs.readFileSync(page.file, "utf8");
    const hasPoll = html.includes("data-motm-poll");
    const matchId = page.name.replace(/\.html$/, "");
    if (hasPoll) {
      printed += 1;
      assert.ok(eligible.has(matchId), `${page.dir}/${page.name}: hak etmeyen sayfada anket var`);
      // Blok sayfada bir kez.
      assert.equal((html.match(/data-motm-poll/g) || []).length, 1,
        `${page.dir}/${page.name}: anket yinelenmiş`);
    }
  }
  assert.ok(printed > 0, "en az bir sayfada anket basılmış olmalı");
  console.log(`  ok  ${printed} sayfada anket basılı, ${pages.length - printed} sayfada yok`);
}

// ── 12. OYLAMA PENCERESİ: maç sonundan 24 saat sonra kapanır ───────────────
//
// Kapanan anket YOK OLMAZ, KİLİTLENİR: `poll` üretilmeye devam eder
// (sonuçlar gösterilecek), yalnızca `votingOpen` düşer. Pencere sunucuda da
// ayrıca kapatılıyor (test-motm-vote-api); buradaki sözleşme seçim katmanı.
{
  const kickoff = "2026-08-01T20:00:00+03:00";
  const kickoffMs = Date.parse(kickoff);
  const closesMs = kickoffMs + MATCH_DURATION_APPROX_MS + VOTING_WINDOW_AFTER_MATCH_MS;

  assert.equal(votingClosesAtMs(match({ kickoff })), closesMs, "kapanış = başlama + 2sa + 24sa olmalı");

  // Pencere içinde açık, sınırda ve sonrasında kapalı.
  assert.equal(isVotingOpen(match({ kickoff }), closesMs - 1), true);
  assert.equal(isVotingOpen(match({ kickoff }), closesMs), false);
  assert.equal(isVotingOpen(match({ kickoff }), closesMs + 1), false);

  const open = buildMotmPoll(match({ kickoff }), { now: closesMs - 1 }).poll;
  assert.equal(open.votingOpen, true);
  assert.equal(open.closesAt, new Date(closesMs).toISOString(), "kapanış istemciye ISO olarak gitmeli");

  const closed = buildMotmPoll(match({ kickoff }), { now: closesMs + 1 }).poll;
  assert.ok(closed, "kapanan anket yok olmamalı, kilitlenmeli");
  assert.equal(closed.votingOpen, false);

  // Başlama saati OKUNAMAYAN maçta kapanış hesaplanamaz ve oylama açık
  // kalır — uydurma bir kapanış saati ilan edilmez.
  assert.equal(votingClosesAtMs(match()), 0);
  assert.equal(isVotingOpen(match(), Date.parse("2099-01-01")), true);
  assert.equal(buildMotmPoll(match()).poll.closesAt, null);

  // İşaretleme: kapanış saati veri olarak taşınır, kilit notu blokta hazır.
  const html = motmPollBlock(open);
  assert.ok(html.includes(`data-motm-closes="${open.closesAt}"`), "kapanış işaretlemede taşınmalı");
  assert.ok(html.includes('data-motm-note="closed"'), "kilit notu blokta olmalı");
  assert.ok(html.includes(COPY.closedNote), "kilit notunun metni COPY'den gelmeli");
  assert.ok(!motmPollBlock(buildMotmPoll(match()).poll).includes("data-motm-closes"),
    "kapanışı bilinmeyen maçta öznitelik basılmamalı");

  // İstemci sözleşmesi: kilit kancaları site.js'te.
  const client = fs.readFileSync(path.join(root, "site.js"), "utf8");
  for (const hook of ["data-motm-closes", 'data-motm-note="closed"', "votingOpen === false"]) {
    assert.ok(client.includes(hook), `site.js "${hook}" kancasını kaybetmiş`);
  }
}

console.log("motm-poll OK");
