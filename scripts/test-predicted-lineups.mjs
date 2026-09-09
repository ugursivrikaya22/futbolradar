#!/usr/bin/env node
/**
 * MUHTEMEL 11 VERİSİ — SÖZLEŞME DENETİMİ.
 *
 * `data/predicted-lineups.json` editoryal/kaynak gösterilmiş bir tahmindir,
 * resmî kadro DEĞİLDİR. Bu testin tek kırmızı çizgisi: dosyaya sızabilecek
 * sessiz bozulmaları (eşleşmeyen fikstür, eksik/fazla oyuncu, sağdan-sola
 * kuralını bozan satır, kaynağı gösterilmeyen kayıt) derleme zamanında
 * yakalamak — okuyucuya 10 ya da 12 oyunculu bir "ilk 11" hiç gösterilmez.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

console.log("predicted-lineups");

const root = process.cwd();
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));

const predicted = readJson("data/predicted-lineups.json");
const fixtureCalendar = readJson("data/fixture-calendar.json");
const fixturesById = new Map(
  (Array.isArray(fixtureCalendar.matches) ? fixtureCalendar.matches : [])
    .filter((row) => row && row.id)
    .map((row) => [row.id, row])
);

assert.ok(Array.isArray(predicted.matches) && predicted.matches.length > 0, "en az bir maç kaydı olmalı");
assert.equal(predicted.lineupStatus, "predicted", "lineupStatus 'predicted' olmalı — resmî statüyle karışmamalı");
assert.ok(predicted.sources && typeof predicted.sources === "object", "kaynak (sources) haritası olmalı");

// ── 1. HER MAÇ GERÇEK FİKSTÜRE BAĞLANIR ────────────────────────────────────
// matchId, kaynak dosyanın editoryal id'si DEĞİL — data/fixture-calendar.json
// içindeki gerçek kayıttır. Bağlanamayan bir kimlik, sayfanın hiçbir zaman
// bulamayacağı bir maç demektir.
const seenMatchIds = new Set();
for (const match of predicted.matches) {
  const id = match && match.matchId;
  assert.ok(id, `matchId zorunlu (editorialId=${match && match.editorialId})`);
  assert.ok(!seenMatchIds.has(id), `matchId yinelenmiş: ${id}`);
  seenMatchIds.add(id);

  const fixture = fixturesById.get(id);
  assert.ok(fixture, `${id}: fikstür takviminde bulunamadı (data/fixture-calendar.json)`);

  if (fixture && match.kickoff) {
    assert.equal(
      Date.parse(match.kickoff),
      Date.parse(fixture.kickoff),
      `${id}: kickoff fikstürle uyuşmuyor (${match.kickoff} vs ${fixture.kickoff})`
    );
  }
}

// ── 2. HER TARAFTA TAM 11 OYUNCU, TEK KALECİ ───────────────────────────────
// rows[0] her zaman kaleci hattıdır ve TEK oyuncu taşımalı; toplam 11'i
// aşan/altında kalan bir kadro "ilk 11" değildir.
function assertSide(matchId, sideName, side) {
  assert.ok(side, `${matchId}.${sideName} zorunlu`);
  assert.ok(typeof side.name === "string" && side.name.trim(), `${matchId}.${sideName}.name zorunlu`);
  assert.ok(typeof side.formation === "string" && /^\d(-\d)+$/.test(side.formation), `${matchId}.${sideName}.formation geçersiz: ${side.formation}`);
  assert.ok(Array.isArray(side.rows) && side.rows.length >= 3, `${matchId}.${sideName}.rows en az 3 hat içermeli`);

  const [gkRow, ...outfieldRows] = side.rows;
  assert.equal(gkRow.length, 1, `${matchId}.${sideName}: ilk hat (kaleci) tam bir oyuncu içermeli, ${gkRow.length} bulundu`);

  const total = side.rows.reduce((sum, row) => sum + row.length, 0);
  assert.equal(total, 11, `${matchId}.${sideName}: toplam oyuncu 11 olmalı, ${total} bulundu`);

  // Formasyon dizesiyle hat sayıları tutarlı olmalı (kaleci hariç).
  const formationCounts = side.formation.split("-").map(Number);
  assert.deepEqual(
    outfieldRows.map((row) => row.length),
    formationCounts,
    `${matchId}.${sideName}: rows formation ile uyuşmuyor (${side.formation})`
  );

  // Her hatta CSS'in desteklediği en fazla 4 oyuncu (match-special__pitch-row.is-1..is-4).
  for (const row of side.rows) {
    assert.ok(row.length >= 1 && row.length <= 4, `${matchId}.${sideName}: bir hatta 1-4 oyuncu olmalı, ${row.length} bulundu`);
  }

  const names = side.rows.flat();
  assert.equal(new Set(names).size, names.length, `${matchId}.${sideName}: yinelenen oyuncu adı var`);

  // flags: yalnızca kadroda GERÇEKTEN olan oyunculara işaret edebilir.
  for (const flagged of side.flags || []) {
    assert.ok(names.includes(flagged), `${matchId}.${sideName}.flags: '${flagged}' kadroda yok`);
  }

  // sourceKeys: üst düzey sources haritasında karşılığı olmalı.
  assert.ok(Array.isArray(side.sourceKeys) && side.sourceKeys.length > 0, `${matchId}.${sideName}.sourceKeys zorunlu`);
  for (const key of side.sourceKeys) {
    assert.ok(predicted.sources[key], `${matchId}.${sideName}.sourceKeys: '${key}' sources haritasında yok`);
  }
}

for (const match of predicted.matches) {
  assertSide(match.matchId, "home", match.home);
  assertSide(match.matchId, "away", match.away);
}

console.log(`predicted-lineups: ${predicted.matches.length} maç, ${predicted.matches.length * 2} kadro doğrulandı.`);
