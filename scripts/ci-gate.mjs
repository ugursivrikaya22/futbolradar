#!/usr/bin/env node
/**
 * Interaction checks kapısı: `production` işi çalışmalı mı? (kural: scripts/lib/ciGate.mjs)
 * Çıktı: GITHUB_OUTPUT → run=true|false, reason=<kod>. Hatada çalışmayı seçer.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { decideCi } from "./lib/ciGate.mjs";

const event = process.env.GITHUB_EVENT_NAME || "";
const draft = process.env.PR_DRAFT || "false";
const pr = process.env.PR_NUMBER || "";
const repo = process.env.GITHUB_REPOSITORY || "";

let files = null;
// Dosya listesi yalnızca taslak olmayan PR için gerekir (taslak zaten atlanıyor).
if (event === "pull_request" && String(draft).toLowerCase() !== "true" && pr && repo) {
  try {
    files = execFileSync("gh", ["api", "--paginate", `repos/${repo}/pulls/${pr}/files`, "--jq", ".[].filename"], {
      encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024
    }).split("\n").map((line) => line.trim()).filter(Boolean);
  } catch (error) {
    console.warn(`[ci-gate] değişen dosyalar alınamadı (${String(error.message || error).slice(0, 120)}); CI çalışacak.`);
  }
}

const decision = decideCi({ event, draft, files });
const lines = [`run=${decision.run}`, `reason=${decision.reason}`];
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n## CI kapısı\n- Karar: **${decision.run ? "çalıştır" : "atla"}**\n- Neden: \`${decision.reason}\`\n${decision.run ? "" : "- Taslak PR'da CI gerekirse: Actions → Interaction checks → Run workflow.\n"}`);
}
console.log(`[ci-gate] event=${event} draft=${draft} files=${files ? files.length : "n/a"} → run=${decision.run} (${decision.reason})`);
