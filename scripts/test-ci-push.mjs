/**
 * YARIŞA DAYANIKLI PUSH — gerçek git depolarıyla sınanır.
 *
 * Bu testin taklit (mock) kullanmamasının sebebi, sınanan şeyin git'in
 * KENDİ davranışı olması: bir push hangi koşulda reddedilir, rebase neyi
 * çakışma sayar. Taklit edilmiş bir git, yalnızca benim git hakkındaki
 * varsayımlarımı doğrulardı — ki run 121'i düşüren şey tam olarak yanlış
 * bir varsayımdı.
 *
 * Her senaryo için geçici bir "origin" (bare) deposu ve iki klon kurulur:
 * biri CI koşucusu, diğeri araya giren merge.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const root = process.cwd();
const script = path.join(root, "scripts", "ci-commit-push.mjs");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * `spawnSync`, `execFileSync` DEĞİL: erteleme bildirimi `console.warn` ile
 * stderr'e gidiyor ve `execFileSync` başarılı bir koşuda yalnızca stdout
 * döndürüyor. İlk yazımda bu yüzden çakışma senaryosu, betik doğru
 * davranırken bile "mesaj yok" diye kırılmıştı.
 */
function runPushScript(cwd, message) {
  const result = spawnSync(process.execPath, [script, message], { cwd, encoding: "utf8" });
  return {
    code: result.status === null ? 1 : result.status,
    output: `${String(result.stdout || "")}${String(result.stderr || "")}`
  };
}

/** Bir origin + bir çalışma klonu kurar. */
function makeWorld(label) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `ci-push-${label}-`));
  const origin = path.join(base, "origin.git");
  const work = path.join(base, "work");
  const other = path.join(base, "other");

  fs.mkdirSync(origin);
  git(origin, ["init", "--bare", "--initial-branch=main"]);

  git(base, ["clone", origin, "work"]);
  git(work, ["config", "user.name", "seed"]);
  git(work, ["config", "user.email", "seed@example.com"]);
  fs.writeFileSync(path.join(work, "data.json"), '{"deger": 1}\n');
  git(work, ["add", "-A"]);
  git(work, ["commit", "-m", "seed"]);
  git(work, ["push", "-u", "origin", "main"]);

  git(base, ["clone", origin, "other"]);
  git(other, ["config", "user.name", "other"]);
  git(other, ["config", "user.email", "other@example.com"]);

  return { base, origin, work, other };
}

function originLog(origin) {
  return git(origin, ["log", "--oneline", "main"]).trim().split("\n");
}

function cleanup(world) {
  fs.rmSync(world.base, { recursive: true, force: true });
}

// ── 1. Değişiklik yoksa commit atılmaz ─────────────────────────────────────
{
  const world = makeWorld("noop");
  const before = originLog(world.origin).length;

  const result = runPushScript(world.work, "ci(test): boş koşu");

  assert.equal(result.code, 0, "değişiklik yokken çıkış 0 olmalı");
  assert.match(result.output, /değişiklik yok/, "boş koşu açıkça bildirilmeli");
  assert.equal(originLog(world.origin).length, before, "boş koşu commit atmamalı");

  cleanup(world);
}

// ── 2. Uzak dal kımıldamadıysa doğrudan itilir ─────────────────────────────
{
  const world = makeWorld("fastpath");

  fs.writeFileSync(path.join(world.work, "data.json"), '{"deger": 2}\n');
  const result = runPushScript(world.work, "ci(test): düz push");

  assert.equal(result.code, 0, "temiz push çıkış 0 olmalı");
  assert.match(result.output, /itildi \(deneme 1\//, "ilk denemede itilmeli");
  assert.equal(originLog(world.origin).length, 2, "commit origin'e ulaşmalı");

  cleanup(world);
}

// ── 3. RUN 121 SENARYOSU: araya merge girer, push reddedilir ───────────────
//
// Bu, düzeltilmek istenen tam olay. Eskiden burada koşu kırmızıya dönüyor ve
// tazelenen veri kayboluyordu.
{
  const world = makeWorld("race");

  // Araya giren commit: FARKLI bir dosya, yani içerik çakışması yok —
  // sorun yalnızca uzak dalın ilerlemiş olması.
  fs.writeFileSync(path.join(world.other, "baska.md"), "merge edilen iş\n");
  git(world.other, ["add", "-A"]);
  git(world.other, ["commit", "-m", "merge: başka bir iş"]);
  git(world.other, ["push", "origin", "main"]);

  // CI koşucusu bundan habersiz; kendi çıktısını yazıyor.
  fs.writeFileSync(path.join(world.work, "data.json"), '{"deger": 3}\n');
  const result = runPushScript(world.work, "ci(test): yarış");

  assert.equal(result.code, 0, "yarış çözülmeli, koşu kırmızıya dönmemeli");
  assert.match(result.output, /push reddedildi \(deneme 1\//, "ilk deneme reddedilmeli");
  assert.match(result.output, /üzerine taşındı/, "commit son hâlin üzerine taşınmalı");
  assert.match(result.output, /itildi \(deneme 2\//, "ikinci denemede itilmeli");

  const log = originLog(world.origin);
  assert.equal(log.length, 3, "hem merge hem CI commit'i durmalı");

  // ARAYA GİREN İŞ YOK EDİLMEMELİ. Zorla push tam olarak bunu silerdi.
  assert.ok(
    fs.existsSync(path.join(world.other, "baska.md")),
    "araya giren commit'in dosyası korunmalı"
  );
  git(world.other, ["pull", "--ff-only"]);
  assert.equal(
    fs.readFileSync(path.join(world.other, "data.json"), "utf8").trim(),
    '{"deger": 3}',
    "CI çıktısı origin'e ulaşmalı"
  );
  assert.ok(
    fs.existsSync(path.join(world.other, "baska.md")),
    "merge edilen iş rebase sonrası da durmalı"
  );

  cleanup(world);
}

// ── 4. Gerçek çakışma: birleştirme UYDURULMAZ ──────────────────────────────
//
// İki taraf da aynı üretilmiş dosyanın aynı satırını değiştirdi. Üretilmiş
// dosyada "hangi taraf haklı" sorusunun anlamlı cevabı yok; doğru çıktı en
// güncel girdilerden yeniden üretilendir. Bu yüzden koşu ertelenir.
{
  const world = makeWorld("conflict");

  fs.writeFileSync(path.join(world.other, "data.json"), '{"deger": 99}\n');
  git(world.other, ["add", "-A"]);
  git(world.other, ["commit", "-m", "merge: aynı dosyayı değiştirdi"]);
  git(world.other, ["push", "origin", "main"]);

  fs.writeFileSync(path.join(world.work, "data.json"), '{"deger": 4}\n');
  const result = runPushScript(world.work, "ci(test): çakışma");

  // Yayınlanamayan çıktı artık "tamamlandı" sayılmaz: çıkış kodu 1, defter
  // finalize-operations-publication.mjs ile publication=failed yazar.
  assert.equal(result.code, 1, "yayınlanamayan çıktı koşuyu kırmızıya döndürmeli");
  assert.match(result.output, /ERTELENDİ/, "erteleme açıkça bildirilmeli");
  assert.match(result.output, /yeniden üret/, "gerekçe günlüğe düşmeli");

  // Origin'de YALNIZCA araya giren commit olmalı; bizimki yazılmadı.
  const log = originLog(world.origin);
  assert.equal(log.length, 2, "çakışmada bizim commit'imiz yazılmamalı");

  git(world.other, ["pull", "--ff-only"]);
  assert.equal(
    fs.readFileSync(path.join(world.other, "data.json"), "utf8").trim(),
    '{"deger": 99}',
    "araya giren içerik ezilmemeli"
  );

  // Rebase yarıda bırakılmamış olmalı: depo temiz bir durumda kalmalı,
  // yoksa sonraki adımlar anlaşılmaz biçimde çöker.
  const state = git(world.work, ["status", "--porcelain=v2", "--branch"]);
  assert.ok(!/rebase/i.test(state), "rebase iptal edilmiş olmalı");

  cleanup(world);
}

// ── 5. Ayrık HEAD'de dal uydurulmaz ────────────────────────────────────────
{
  const world = makeWorld("detached");

  const head = git(world.work, ["rev-parse", "HEAD"]).trim();
  git(world.work, ["checkout", "--detach", head]);
  fs.writeFileSync(path.join(world.work, "data.json"), '{"deger": 5}\n');

  const result = runPushScript(world.work, "ci(test): ayrık");

  assert.equal(result.code, 1, "ayrık HEAD'de dal uydurmak yerine durulmalı");
  assert.match(result.output, /ayrık HEAD/, "sebep bildirilmeli");
  assert.equal(originLog(world.origin).length, 1, "hiçbir şey itilmemeli");

  cleanup(world);
}

console.log("CI push testleri geçti (boş koşu, düz push, yarış çözümü, çakışmada erteleme, ayrık HEAD koruması).");
