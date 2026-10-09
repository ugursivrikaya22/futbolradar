#!/usr/bin/env node
/**
 * ZAMANLANMIŞ GÜNCELLEME — ADIM ZAMAN AŞIMI SÜREÇ AĞACINI DURDURUR.
 *
 * 9 Ekim koşusu (37872768808) `full-static-build` için 3.900.000 ms sınırına
 * karşın 4.814.429 ms sonra kaydedildi: sinyal yalnızca `npm`e gidiyor,
 * torunlar (tarayıcı denetimi) boruları açık tutup çalışmayı sürdürüyordu.
 * Bu denetim aynı şekli küçültülmüş olarak kurar: bir ebeveyn, boruları
 * miras alan ve SIGTERM'i YOK SAYAN uzun ömürlü bir torun başlatır.
 * Beklenen: runProcess sınır + öldürme payı içinde başarısız döner ve torun
 * ölür. Ayrıca normal başarı/başarısızlık sonuçları değişmemiş olmalı.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runProcess } from "./run-scheduled-update.mjs";

const NODE = process.execPath;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-runprocess-"));
const pidFile = path.join(dir, "grandchild.pid");
const parent = path.join(dir, "parent.cjs");
fs.writeFileSync(parent, `
const { spawn } = require("node:child_process");
const fs = require("node:fs");
// Torun stdout/stderr'i miras alır (borular açık kalır) ve SIGTERM'i yok sayar.
const g = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{}, 1000); console.log('grandchild up');"], { stdio: ["ignore", "inherit", "inherit"] });
fs.writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));
setInterval(() => {}, 1000);
`);

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
const ok = (name) => { checks += 1; console.log(`ok - ${name}`); };

try {
  // 1) Normal başarı ve başarısızlık değişmedi.
  const success = await runProcess(NODE, ["-e", "console.log('FUTBOLRADAR_STEP_SUMMARY {\"n\":1}')"], { timeoutMs: 10_000 });
  assert.equal(success.ok, true); assert.equal(success.code, 0); assert.equal(success.error, null); assert.equal(success.timedOut, false);
  assert.deepEqual(success.summary, { n: 1 });
  ok("başarılı adım: ok, kod 0, özet okunuyor");
  const failure = await runProcess(NODE, ["-e", "process.exit(3)"], { timeoutMs: 10_000 });
  assert.equal(failure.ok, false); assert.equal(failure.code, 3); assert.equal(failure.error, "Exited with code 3"); assert.equal(failure.timedOut, false);
  ok("başarısız adım: kod ve hata metni aynı");

  if (process.platform === "win32") {
    console.log("SKIP süreç grubu denetimi (POSIX dışı)");
  } else {
    // 2) Zaman aşımı: sınır + öldürme payı içinde dön, torun ölsün.
    const timeoutMs = 1_000, killGraceMs = 1_000;
    const started = Date.now();
    // Eski davranışta (yalnızca 'close' beklenince) bu çağrı hiç dönmüyordu;
    // denetim asılı kalmasın, açıkça kırmızı versin.
    let watchdog;
    const result = await Promise.race([
      runProcess(NODE, [parent], { timeoutMs, killGraceMs }),
      new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error("runProcess zaman aşımından sonra 15 sn içinde dönmedi (torun borularını bekliyor)")), 15_000); })
    ]).finally(() => clearTimeout(watchdog));
    const elapsed = Date.now() - started;
    assert.equal(result.ok, false, "zaman aşımı başarısızlıktır");
    assert.equal(result.timedOut, true);
    assert.equal(result.error, `Timed out after ${timeoutMs}ms`);
    assert.ok(elapsed < timeoutMs + killGraceMs + 3_000, `sonuç gecikti: ${elapsed} ms`);
    ok(`zaman aşımı ${elapsed} ms'de başarısız olarak kaydedildi (sınır ${timeoutMs} + pay ${killGraceMs})`);
    const grandchild = Number(fs.readFileSync(pidFile, "utf8"));
    let dead = false;
    for (let i = 0; i < 40 && !dead; i += 1) { dead = !alive(grandchild); if (!dead) await sleep(100); }
    assert.ok(dead, `SIGTERM'i yok sayan torun (${grandchild}) hâlâ yaşıyor`);
    ok("SIGTERM'i yok sayan torun SIGKILL ile durduruldu");
  }
  console.log(`[run-process-timeout] ${checks} denetim geçti.`);
} finally {
  try {
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    if (pid && alive(pid)) process.kill(pid, "SIGKILL");
  } catch { /* no-op */ }
  fs.rmSync(dir, { recursive: true, force: true });
}
// Eski davranışta asılı kalan alt süreçler döngüyü tutmasın.
process.exit(process.exitCode || 0);
