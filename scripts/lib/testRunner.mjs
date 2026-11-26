/**
 * TEST KOŞUCUSU — `npm test` zinciri DİZİN TABANLI.
 *
 * `package.json`'daki `test` tek bir ~8.000 karakterlik `a && b && c ...` satırıydı.
 * Her PR aynı satıra bir test ekliyordu; Git satır bazlı birleştirdiği için
 * eşzamanlı her PR, birleşme sırası ne olursa olsun `package.json`'da ÇAKIŞIYORDU
 * (aynı gün içinde defalarca elle çözüldü).
 *
 * Artık komutlar `scripts/tests.d/*.list` dosyalarında, SATIR BAŞINA BİR KOMUT.
 * Yeni test eklemek = yeni bir `.list` dosyası (ya da kendi dosyanıza satır) —
 * ortak bir satıra dokunmak yok, dolayısıyla çakışma yok.
 *
 * Kurallar (eski `&&` zinciriyle aynı anlam):
 *   • Dosyalar ada göre sıralı okunur; içindeki satırlar yukarıdan aşağıya koşar.
 *   • İlk başarısız komutta DURUR ve onun çıkış koduyla çıkar (fail-fast).
 *   • Boş satırlar ve `#` ile başlayanlar yorumdur.
 *   • Komut satırı olduğu gibi kabuğa verilir (`node scripts/test-x.mjs`,
 *     `node --test tests/y.test.mjs` ...).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(".list")).sort();
}

/** @returns {{file:string, line:number, command:string}[]} */
export function loadCommands(dir) {
  const commands = [];
  for (const file of listFiles(dir)) {
    fs.readFileSync(path.join(dir, file), "utf8").split(/\r?\n/).forEach((raw, index) => {
      const command = raw.trim();
      if (!command || command.startsWith("#")) return;
      commands.push({ file, line: index + 1, command });
    });
  }
  return commands;
}

/** `node [--test] yol...` komutunun dosya yollarını döndürür (başka biçim: boş dizi). */
export function pathsOf(command) {
  const match = /^node(?:\s+--test)?\s+(.+)$/.exec(command);
  if (!match) return [];
  return match[1].split(/\s+/).filter((token) => !token.startsWith("-") && /[\\/]/.test(token));
}

/**
 * Sırayla koşturur; ilk başarısızlıkta durur.
 * @param {{command:string}[]} commands
 * @param {{cwd?:string, run?:(command:string)=>{status:number|null}, log?:(line:string)=>void}} [options]
 * @returns {{ok:boolean, status:number, ran:number, failed:string|null}}
 */
export function runCommands(commands, { cwd = process.cwd(), run, log = console.log } = {}) {
  const exec = run || ((command) => spawnSync(command, { cwd, shell: true, stdio: "inherit" }));
  let ran = 0;
  for (const [index, { command }] of commands.entries()) {
    log(`\n[tests] ${index + 1}/${commands.length}: ${command}`);
    const result = exec(command);
    ran += 1;
    if (result.status !== 0) {
      const status = typeof result.status === "number" ? result.status : 1;
      log(`[tests] BAŞARISIZ (çıkış ${status}): ${command}`);
      return { ok: false, status, ran, failed: command };
    }
  }
  return { ok: true, status: 0, ran, failed: null };
}
