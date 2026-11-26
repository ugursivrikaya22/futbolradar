#!/usr/bin/env node
/**
 * `npm test` giriş noktası. Komutlar scripts/tests.d/*.list içinde (bkz.
 * scripts/lib/testRunner.mjs). Seçenekler:
 *   --list            komutları yazar, koşturmaz
 *   --only=<metin>    yalnızca komutu <metin> içerenleri koşturur
 */
import path from "node:path";
import { loadCommands, runCommands } from "./lib/testRunner.mjs";

const root = process.cwd();
const dir = path.join(root, "scripts", "tests.d");
const args = process.argv.slice(2);
const only = (args.find((arg) => arg.startsWith("--only=")) || "").slice("--only=".length);

let commands = loadCommands(dir);
if (only) commands = commands.filter(({ command }) => command.includes(only));

if (args.includes("--list")) {
  for (const { file, command } of commands) console.log(`${file}\t${command}`);
  console.log(`# ${commands.length} komut`);
  process.exit(0);
}
if (!commands.length) {
  console.error(`[tests] koşturulacak komut yok (${only ? `--only=${only}` : "scripts/tests.d/*.list boş"}).`);
  process.exit(1);
}

const result = runCommands(commands, { cwd: root });
if (result.ok) console.log(`\n[tests] ${result.ran} komutun hepsi geçti.`);
process.exit(result.status);
