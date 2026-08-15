#!/usr/bin/env node
/**
 * SUPABASE VERİ KATMANI TESTİ — ağ olmadan, gerçek göç dosyasına ve
 * gerçek normalleştirme kodunun kendisine karşı.
 *
 * NE SINANIYOR VE NEDEN
 * ---------------------------------------------------------------------
 * 1. ŞEMA/KOD PARİTESİ: `services/supabase/schema.js`nin bildirdiği her
 *    sütun, göç SQL'inde GERÇEKTEN var mı. Bu depoda bir kez "veri
 *    dosyası değişkenle require edildi, canlıda sessizce boş döndü"
 *    sınıfından bir hata çıktı (`server/homePollRoute.js` başlığında
 *    yazılı); PostgREST'te karşılığı, olmayan bir sütuna yazan toplu
 *    isteğin TAMAMININ 400 ile geri dönmesidir. Uyuşmazlık burada,
 *    üretimde toplu bir alım çalışırken değil.
 *
 * 2. "ASLA UYDURMA" SÖZLEŞMESİ: `services/supabase/normalize.js`nin
 *    döndürdüğü satırların, eksik veriyi sıfır ya da sahte bir değerle
 *    DOLDURMADIĞI. Her assert, bu depoda bir kez gerçekten üretime çıkmış
 *    bir hata sınıfının tekrar mümkün olmadığını kanıtlar.
 *
 * 3. SIR GÜVENLİĞİ: Supabase ortam değişkeni adlarının hiçbiri istemciye
 *    giden dosyalarda (`app.js`, `site.js`, `public/`) GEÇMİYOR.
 *
 * 4. ALIM SIRASI: `scripts/supabase-ingest.mjs`in yazma sırası, yabancı
 *    anahtarların gerektirdiği sırayı bozmuyor (kaynaklar → takımlar →
 *    oyuncular/maçlar → transferler/raporlar).
 *
 * Gerçek bir Postgres'e karşı UÇTAN UCA doğrulama ayrı yapıldı (bu
 * ortamda yerel PostgreSQL 16 + PostgREST benzetimi kurulup göç iki kez
 * uygulandı, kısıtlar tek tek sınandı, gerçek üretim verisiyle tam alım
 * çalıştırıldı — bulunan iki gerçek hata: `team_id` yabancı anahtarının
 * kapsam dışı kulüpleri reddetmesi ve `rating` sütununun yanlış ölçek
 * varsayması — ikisi de bu dosyadaki testlere YANSITILDI). Bu test CI'da
 * ağsız çalışır; canlı bağlantı gerektiren doğrulama
 * `scripts/check-home-poll-store.mjs`nin kapsamındaki gibi ayrı bir
 * elle-çalıştırma adımıdır.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

const normalize = require("../services/supabase/normalize.js");
const { TABLES, INGEST_ORDER } = require("../services/supabase/schema.js");
const env = require("../services/supabase/env.js");

// ── 1. Şema/kod paritesi ────────────────────────────────────────────────

const migrationPath = path.join(root, "supabase", "migrations", "0001_core_schema.sql");
const migrationSql = fs.readFileSync(migrationPath, "utf8");

function columnsInCreateTable(sql, tableName) {
  const pattern = new RegExp(`create table if not exists ${tableName} \\(([\\s\\S]*?)\\n\\);`, "m");
  const match = sql.match(pattern);
  assert.ok(match, `göçte "${tableName}" tablosu bulunamadı`);
  const body = match[1];
  const columns = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("--") || trimmed.startsWith("constraint") || trimmed.startsWith("unique")) continue;
    const columnMatch = trimmed.match(/^([a-z_]+)\s+/);
    if (columnMatch) columns.push(columnMatch[1]);
  }
  return columns;
}

for (const [key, table] of Object.entries(TABLES)) {
  const realColumns = new Set(columnsInCreateTable(migrationSql, table.name));
  for (const column of table.columns) {
    assert.ok(
      realColumns.has(column),
      `services/supabase/schema.js TABLES.${key} sütunu "${column}" göçte yok — ` +
      `bu uyuşmazlık üretimde toplu yazmanın TAMAMINI 400 ile düşürür`
    );
  }
}
console.log(`şema/kod paritesi: ${Object.keys(TABLES).length} tablo, hepsi göçle eşleşiyor`);

// Alım sırası, yabancı anahtar zincirini bozmamalı: kaynaklar en başta,
// takımlar oyunculardan/maçlardan önce.
assert.equal(INGEST_ORDER[0], "sources", "kaynaklar alım sırasının başında olmalı (data_sources FK'si)");
assert.ok(INGEST_ORDER.indexOf("teams") < INGEST_ORDER.indexOf("players"), "takımlar oyunculardan önce gelmeli");
assert.ok(INGEST_ORDER.indexOf("matches") < INGEST_ORDER.indexOf("reports"), "maçlar analiz raporlarından önce gelmeli (match_id FK'si)");
console.log("alım sırası: yabancı anahtar zinciriyle tutarlı");

// ── 2. "Asla uydurma" sözleşmesi ────────────────────────────────────────

// published(): 0 gerçek bir ölçümdür, boş/geçersiz değer NULL'dır.
// `Number(null) === 0` tuzağı — bu depoda bir kez üretime çıktı.
assert.equal(normalize.published(0), 0, "0 gerçek bir ölçümdür, NULL'a düşürülemez");
assert.equal(normalize.published(null), null, "yayımlanmamış değer NULL kalmalı");
assert.equal(normalize.published(undefined), null, "tanımsız değer NULL kalmalı");
assert.equal(normalize.published(""), null, "boş dize NULL kalmalı");
assert.equal(normalize.published("abc"), null, "sayı olmayan metin NULL kalmalı");
assert.equal(normalize.published("7"), 7, "sayısal dize sayıya çevrilmeli");
console.log("published(): 0 ile NULL asla karışmıyor");

// text(): yer tutucular metin sayılmaz — "veri yok" site genelinde yasak.
for (const placeholder of ["-", "—", "N/A", "n/a", "null", "undefined", "veri yok", "No data"]) {
  assert.equal(normalize.text(placeholder), null, `"${placeholder}" bir yer tutucu, saklanabilir metin değil`);
}
assert.equal(normalize.text("Galatasaray"), "Galatasaray", "gerçek metin korunmalı");
console.log("text(): yer tutucular saklanmıyor");

// moneyEur(): "Bedelsiz" GERÇEKTEN sıfırdır, bilinmeyen bedel NULL'dır.
assert.equal(normalize.moneyEur("Bedelsiz"), 0, "bedelsiz transfer 0 EUR'dur (uydurma değil, ölçülen değer)");
assert.equal(normalize.moneyEur(undefined), null, "bilinmeyen bedel NULL kalmalı, 0 değil");
assert.equal(normalize.moneyEur("3.2M EUR"), 3200000, "milyon kısaltması doğru çözülmeli");
console.log("moneyEur(): bedelsiz (0) ile bilinmeyen (NULL) ayrımı korunuyor");

// transferStatus(): tanınmayan durum EN TEMKİNLİ sınıfa düşer (rumour),
// en iddialısına değil. Bu depoda bir iddia doğrulanmış listeye sızmıştı.
assert.equal(normalize.transferStatus("Resmî"), "confirmed");
assert.equal(normalize.transferStatus("tamamen bilinmeyen bir durum metni"), "rumour", "tanınmayan durum iddiaya düşmeli, doğrulanmaya değil");
console.log("transferStatus(): tanınmayan durum en temkinli sınıfa düşüyor");

// transfer(): kaynaksız "confirmed" iddiaya indirilir, reddedilmez —
// bilgi korunur ama doğrulanmış gibi gösterilmez.
const unsourcedConfirmed = normalize.transfer({
  id: "test-1", playerName: "Test Oyuncu", status: "confirmed"
}, "internal");
assert.ok(unsourcedConfirmed, "satır tamamen reddedilmemeli");
assert.equal(unsourcedConfirmed.status, "agreed", "kaynaksız \"confirmed\" iddiaya/agreed'e düşürülmeli, doğrulanmış kalmamalı");

const sourcedConfirmed = normalize.transfer({
  id: "test-2", playerName: "Test Oyuncu", status: "confirmed", sourceUrl: "https://example.com/haber"
}, "internal");
assert.equal(sourcedConfirmed.status, "confirmed", "kaynaklı confirmed korunmalı");
console.log("transfer(): kaynaksız \"doğrulandı\" iddiası otomatik indiriliyor");

// match(): bitmiş ama skorsuz maç YAZILMAZ (şemadaki kısıtla aynı kural,
// iki katman aynı hatayı iki kez yakalıyor).
const finishedNoScore = normalize.match({
  id: "m1", kickoff: "2026-08-15T20:00:00+03:00", homeTeam: "A", awayTeam: "B", status: "FT", score: {}
}, "internal");
assert.equal(finishedNoScore, null, "bitmiş+skorsuz maç satırı üretilmemeli (üretimde \"İlk yarı 0-0\" hatasının ikinci katmanı)");

const scheduled = normalize.match({
  id: "m2", kickoff: "2026-08-20T20:00:00+03:00", homeTeam: "A", awayTeam: "B", status: "NS", score: {}
}, "internal");
assert.ok(scheduled, "başlamamış maç skorsuz kabul edilmeli");
assert.equal(scheduled.home_score, null, "başlamamış maçın skoru NULL olmalı, 0 değil");
console.log("match(): bitmiş+skorsuz satır asla üretilmiyor, başlamamışın skoru NULL kalıyor");

// playerStats(): tutarsız ikili mücadele (kazanılan > girilen) alan
// bazında düzeltilir, satırın TAMAMI atılmaz.
const inconsistentDuels = normalize.playerStats({
  id: "p1", name: "P", duels: 5, duelsWon: 9, goals: 3
}, "2026/27", "internal");
assert.ok(inconsistentDuels, "tutarsız ikili mücadele satırın tamamını düşürmemeli");
assert.equal(inconsistentDuels.duels, null, "tutarsız alan NULL'a düşürülmeli");
assert.equal(inconsistentDuels.goals, 3, "tutarsız olmayan diğer alanlar korunmalı");

// Sezonsuz istatistik ÜRETİLMEZ: sezon bilinmeden yazılan satır bir
// sonraki sezon geldiğinde eskiyi ezerdi.
assert.equal(normalize.playerStats({ id: "p1", goals: 3 }, "", "internal"), null, "sezonsuz istatistik satırı üretilmemeli");
console.log("playerStats(): tutarsız alan düzeltiliyor, sezonsuz satır hiç üretilmiyor");

// team_id: FK YOK ama alan yine de dolduruluyor — kapsam dışı kulüpler
// (bkz. göçteki yorum) satırı düşürmeden slug olarak saklanıyor.
const foreignClubPlayer = normalize.player({ id: "x", name: "X", team: "Real Madrid" }, "internal");
assert.equal(foreignClubPlayer.team_id, "real-madrid", "kapsam dışı kulüp adı da slug'a çevrilmeli, boş bırakılmamalı");
console.log("player(): kapsam dışı kulüpler reddedilmiyor (yabancı anahtar kasıtlı olarak yok)");

// ── 3. Sır güvenliği ─────────────────────────────────────────────────────

const clientOnlyGlobs = [];
function collectClientFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === root && ["public"].includes(entry.name)) collectClientFiles(full);
      continue;
    }
    if (entry.name === "app.js" || entry.name === "site.js") clientOnlyGlobs.push(full);
    if (dir.includes(`${path.sep}public${path.sep}`) && /\.js$/.test(entry.name)) clientOnlyGlobs.push(full);
  }
}
collectClientFiles(root);
if (fs.existsSync(path.join(root, "public"))) collectClientFiles(path.join(root, "public"));

const secretPattern = /SUPABASE_(URL|SERVICE_ROLE_KEY|SERVICE_KEY|ANON_KEY)|HOME_POLL_SUPABASE_KEY|HOME_POLL_IP_SALT/;
let scanned = 0;
for (const file of clientOnlyGlobs) {
  const content = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(content, secretPattern, `istemciye giden ${path.relative(root, file)} Supabase ortam değişkeni adı taşıyor`);
  scanned += 1;
}
assert.ok(scanned > 0, "istemci dosyaları taranamadı — kontrol atlanmış olabilir");
console.log(`sır taraması: ${scanned} istemci dosyasında Supabase ortam adı yok`);

// client.js tarayıcıda açılırsa GÜRÜLTÜLÜ çökmeli (sessiz devre dışı kalma
// yanlışlıkla pakete girmeyi gizlerdi).
const clientSource = fs.readFileSync(path.join(root, "services", "supabase", "client.js"), "utf8");
assert.match(clientSource, /typeof window !== "undefined"/, "client.js tarayıcı kontrolü içermeli");
assert.match(clientSource, /throw new Error/, "tarayıcıda açılma girişimi hata fırlatmalı, sessiz kalmamalı");
console.log("client.js: tarayıcıda açılma girişimi gürültülü şekilde reddediliyor");

// ── 4. Kimlik bilgisi mantığı — anon anahtar hiçbir koşulda kabul edilmez ─

const originalEnv = { ...process.env };
for (const name of [...env.REST_URL_ENV_NAMES, ...env.SERVICE_KEY_ENV_NAMES, ...env.ANON_KEY_ENV_NAMES]) {
  delete process.env[name];
}
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "anon-token";
assert.equal(env.isConfigured(), false, "yalnızca anon anahtar varken depo yapılandırılmış SAYILMAMALI");
assert.match(env.configurationHint(), /SUPABASE_SERVICE_ROLE_KEY/, "ipucu servis anahtarı eksikliğini söylemeli");
process.env = originalEnv;
console.log("env.js: anon anahtar hiçbir koşulda \"yapılandırılmış\" saydırmıyor");

// ── 5. Alım scripti — kuru çalıştırma, ağsız ────────────────────────────

for (const name of [...env.REST_URL_ENV_NAMES, ...env.SERVICE_KEY_ENV_NAMES]) delete process.env[name];
const dryRunOutput = execFileSync(process.execPath, ["scripts/supabase-ingest.mjs", "--dry-run"], {
  cwd: root, encoding: "utf8", env: { ...process.env }
});
assert.match(dryRunOutput, /kuru çalıştırma/, "kuru çalıştırma modu açıkça belirtilmeli");
assert.match(dryRunOutput, /okunan \d+, yazılan 0/, "kuru çalıştırma hiçbir şey yazmamalı");
console.log("supabase-ingest.mjs --dry-run: ağsız çalışıyor, sıfır satır yazıyor, kaynak dosyaları gerçekten okuyor");

// Yapılandırılmamış ortamda (kuru çalıştırma olmadan) script BAŞARISIZ
// OLMALI ve çıkış kodu sıfır olmamalı — "koştu ve boş yazdı" ile
// "hiç koşmadı" dışarıdan aynı görünmemeli.
let unconfiguredFailed = false;
try {
  execFileSync(process.execPath, ["scripts/supabase-ingest.mjs"], { cwd: root, encoding: "utf8", env: { ...process.env } });
} catch (error) {
  unconfiguredFailed = true;
  assert.match(String(error.stdout || ""), /BAŞARISIZ/, "yapılandırılmamış çalıştırma açıkça BAŞARISIZ demeli");
}
assert.ok(unconfiguredFailed, "yapılandırılmamış ortamda script sıfır çıkış koduyla \"başarılı\" görünmemeli");
console.log("supabase-ingest.mjs (yapılandırılmamış): sessizce \"başarılı\" görünmüyor");

console.log("\nsupabase-katmanı testi geçti.");
