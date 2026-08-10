#!/usr/bin/env node
/**
 * OYUNCU FOTOĞRAFI DOĞRULAMA.
 *
 * Kural tek yerde: services/playerPhotoService.js. Fotoğraf ya lisanslı
 * hostta duran bir adrestir (media.api-sports.io) ya da gerçek bir sağlayıcı
 * kimliğinden TÜRETİLİR; ikisi de yoksa oyuncu baş harfleriyle gösterilir.
 * Bu betik o kuralın veri tarafındaki karşılığını denetler: kayıtlı adres
 * hâlâ görsel mi döndürüyor, yoksa kırık mı.
 *
 * NEDEN YENİDEN YAZILDI. Betik, servisin ARTIK VAR OLMAYAN bir sürümüne
 * göre yazılmıştı: `normalizePlayerPhoto`, `getPlayerPhotoUrl`,
 * `isApprovedLocalPhotoUrl` ve `photoMatchesProviderId` dışa aktarılmıyor.
 * İlk çağrıda `normalizePlayerPhoto is not a function` fırlatıyor, catch
 * bloğu bunu "failed safely" diye yazıp exit 1 veriyordu. Yani haftalık
 * fotoğraf denetimi HİÇ ÇALIŞMADI; her pazar sessizce düştü. Ayrıca
 * `player.photo` alanını nesne sanıp `{...current, url, status}` yazıyordu;
 * veri dosyasında o alan bir DİZE, servis de dize bekliyor — apply yolu
 * çalışsaydı 533 oyuncunun fotoğrafını kullanılamaz hâle getirecekti.
 *
 * Artık servisin gerçek sözleşmesini kullanır ve `photo` alanını dize
 * olarak korur. Doğrulama izleri ayrı alanlarda tutulur:
 *   photoStatus       "verified" | "broken" | "unverified" | "placeholder"
 *   photoCheckedAt    son ağ denetiminin zamanı
 * KIRIK ADRES SİLİNMEZ, işaretlenir: adres yanlışsa da kaydın geçmişi
 * kaybolmasın; arayüz zaten `resolvePlayerPhoto` üzerinden yer tutucuya
 * düşüyor.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isAllowedPhotoUrl, providerPhotoId, resolvePlayerPhoto } = require("../services/playerPhotoService.js");

const root = process.cwd();
const PLAYERS_PATH = path.join(root, "data", "players.json");
const PUBLIC_PLAYERS_PATH = path.join(root, "public", "data", "players.json");
const REPORT_PATH = path.join(root, "outputs", "player-photo-validation.json");

function parseArgs(argv) {
  const args = { apply: false, concurrency: 3, staleDays: 14, timeoutMs: 10000, offline: false };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
    else if (raw === "--offline") args.offline = true;
    else if (raw.startsWith("--concurrency=")) args.concurrency = Math.max(1, Math.min(5, Number(raw.slice(14)) || 3));
    else if (raw.startsWith("--stale-days=")) args.staleDays = Math.max(0, Number(raw.slice(13)) || 0);
    else if (raw.startsWith("--timeout-ms=")) args.timeoutMs = Math.max(1000, Number(raw.slice(13)) || 10000);
    else if (raw.startsWith("--limit=")) args.limit = Math.max(1, Number(raw.slice(8)) || 1);
  }
  return args;
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
}

function recentlyChecked(player, staleDays) {
  const timestamp = Date.parse((player && player.photoCheckedAt) || "");
  return Number.isFinite(timestamp) && Date.now() - timestamp < staleDays * 86400000;
}

async function remoteCheck(url, timeoutMs) {
  const request = async (method) => fetch(url, {
    method,
    headers: { accept: "image/*" },
    signal: AbortSignal.timeout(timeoutMs)
  });

  try {
    let response = await request("HEAD");
    if (response.status === 405 || response.status === 501) response = await request("GET");
    const contentType = response.headers.get("content-type") || "";
    if (response.ok && contentType.toLowerCase().startsWith("image/")) {
      return { outcome: "verified", httpStatus: response.status, contentType };
    }
    if ([404, 410].includes(response.status) || (response.ok && !contentType.toLowerCase().startsWith("image/"))) {
      return { outcome: "broken", httpStatus: response.status, contentType };
    }
    // 403/429/5xx: adres kırık DEĞİL, doğrulanamadı. İkisini ayırmak şart —
    // hız limitine takılan bir koşu 500 fotoğrafı "kırık" işaretlememeli.
    return { outcome: "unverified", httpStatus: response.status, contentType };
  } catch (error) {
    return {
      outcome: "transport-error",
      httpStatus: null,
      error: String(error && (error.cause && error.cause.code || error.message) || error).slice(0, 160)
    };
  }
}

/**
 * Aynı adresi birden fazla OYUNCU kullanıyorsa bu bir veri hatasıdır:
 * sağlayıcı adresi kimlikten türetiliyor, kimlik de oyuncuya özgü.
 */
function duplicatePhotoRows(players) {
  const byUrl = new Map();
  for (const player of players) {
    const photo = resolvePlayerPhoto(player);
    if (photo.isPlaceholder || !photo.url) continue;
    if (!byUrl.has(photo.url)) byUrl.set(photo.url, []);
    byUrl.get(photo.url).push({ id: player.id, name: player.name, providerId: player.providerId || null });
  }
  return Array.from(byUrl.entries())
    .filter(([, rows]) => new Set(rows.map((row) => row.providerId || row.id)).size > 1)
    .map(([url, playersForUrl]) => ({ url, players: playersForUrl }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPlayers = JSON.parse(fs.readFileSync(PLAYERS_PATH, "utf8"));
  const limit = Number.isFinite(args.limit) ? args.limit : rawPlayers.length;
  const targets = rawPlayers.slice(0, limit);
  const results = new Array(targets.length);
  let cursor = 0;

  async function worker() {
    while (cursor < targets.length) {
      const index = cursor;
      cursor += 1;
      const player = targets[index];
      const photo = resolvePlayerPhoto(player);
      let check;

      if (photo.isPlaceholder) {
        // Fotoğrafı olmayan oyuncu hata değil: sağlayıcı kimliği yoksa adres
        // ÜRETİLMEZ, baş harf gösterilir. Bu bilinçli bir durum.
        check = { outcome: "placeholder" };
      } else if (!isAllowedPhotoUrl(photo.url)) {
        check = { outcome: "broken", reason: "unlicensed-host" };
      } else if (photo.source === "provider" && providerPhotoId(player) &&
        !photo.url.includes(`/${providerPhotoId(player)}.`)) {
        // Kayıtlı adres BAŞKA bir oyuncunun kimliğini taşıyor.
        check = { outcome: "broken", reason: "provider-id-mismatch" };
      } else if (args.offline) {
        check = { outcome: "structural-only" };
      } else if (recentlyChecked(player, args.staleDays)) {
        check = { outcome: "recently-verified" };
      } else {
        check = await remoteCheck(photo.url, args.timeoutMs);
        await new Promise((resolve) => setTimeout(resolve, 75));
      }

      results[index] = {
        id: player.id,
        name: player.name,
        providerId: player.providerId || null,
        url: photo.url || null,
        photoSource: photo.source,
        ...check
      };
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, () => worker()));
  const duplicates = duplicatePhotoRows(targets);
  const generatedAt = new Date().toISOString();
  const counts = results.reduce((summary, item) => {
    summary[item.outcome] = (summary[item.outcome] || 0) + 1;
    return summary;
  }, {});
  const failures = results.filter((item) => ["broken", "transport-error", "unverified"].includes(item.outcome));
  const report = {
    generatedAt,
    mode: args.apply ? "apply" : "dry-run",
    offline: args.offline,
    totalPlayers: rawPlayers.length,
    checkedPlayers: targets.length,
    counts,
    duplicatePhotoUrls: duplicates,
    failures
  };

  console.log(JSON.stringify({
    generatedAt,
    checkedPlayers: report.checkedPlayers,
    counts,
    duplicatePhotoUrls: duplicates.length,
    applied: args.apply
  }, null, 2));

  if (!args.apply) {
    console.log("Kuru koşu: fotoğraf verisi değiştirilmedi.");
    return;
  }

  const byId = new Map(results.map((result) => [result.id, result]));
  let changed = 0;
  const updated = rawPlayers.map((player) => {
    const result = byId.get(player.id);
    if (!result) return player;

    // Ağ denetimi yapılamayan durumlar kaydı DEĞİŞTİRMEZ: "doğrulanamadı"
    // ile "kırık" aynı şey değil, önceki doğrulama izi de silinmemeli.
    if (["unverified", "transport-error", "recently-verified", "structural-only"].includes(result.outcome)) {
      return player;
    }

    const next = { ...player, photoStatus: result.outcome };
    if (result.outcome === "verified") next.photoCheckedAt = generatedAt;
    if (player.photoStatus === next.photoStatus && player.photoCheckedAt === next.photoCheckedAt) return player;
    changed += 1;
    return next;
  });

  if (changed) {
    atomicWrite(PLAYERS_PATH, updated);
    if (fs.existsSync(path.dirname(PUBLIC_PLAYERS_PATH))) atomicWrite(PUBLIC_PLAYERS_PATH, updated);
  }
  atomicWrite(REPORT_PATH, report);
  console.log(changed
    ? `${changed} oyuncu kaydının fotoğraf denetim izi güncellendi.`
    : "Fotoğraf denetim izlerinde değişiklik yok; oyuncu dosyası aynen bırakıldı.");
}

main().catch((error) => {
  console.error(`Player photo validation failed safely: ${error.message}`);
  process.exitCode = 1;
});
