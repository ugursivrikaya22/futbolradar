/**
 * Supabase'teki veri eserlerini (cron_data_artifacts) bir kök dizindeki
 * `data/` dosyalarının üzerine KOŞULLU olarak uygular.
 *
 * Kullananlar:
 *   - scripts/hydrate-data-from-supabase.mjs (prebuild): build taze veriyi
 *     Supabase'ten okur, API-Football'a HİÇ gitmez.
 *   - services/cron/workdir.js: Vercel fonksiyonunun /tmp çalışma dizini.
 *   - scripts/run-scheduled-update.mjs: GitHub Actions koşusu, Vercel'in
 *     yazdığı daha yeni durumdan başlasın (ör. tahmin deposu "her basamakta
 *     en fazla bir kez sor" kaydı) — aksi hâlde eski durumdan başlayıp aynı
 *     istekleri tekrar atabilirdi.
 *
 * Supabase yapılandırılmamışsa ya da erişilemezse HİÇBİR ŞEY yapmaz ve
 * depo verisi bugünkü gibi kullanılır (fail-open).
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const store = require("./runStore");

/**
 * `relPath` dosyası `commit`ten HEAD'e kadar depoda değişmedi mi?
 * HEAD == commit ise git'e gerek yok. Git yoksa/commit sığ klonda yoksa false
 * (güvenli taraf: depo kazanır).
 */
function gitUnchangedSince(root, headSha) {
  const head = String(headSha || "").toLowerCase();
  return (relPath) => (commit) => {
    if (!/^[a-f0-9]{40}$/.test(commit)) return false;
    if (head && commit === head) return true;
    try {
      execFileSync("git", ["diff", "--quiet", commit, "HEAD", "--", relPath], { cwd: root, stdio: "ignore", timeout: 15000 });
      return true;
    } catch {
      return false;
    }
  };
}

function localSha(file) {
  try { return store.sha256(fs.readFileSync(file)); } catch { return null; }
}

async function hydrateDataDir({ root, request, isConfigured, log = () => {}, gitAware = false, headSha = process.env.VERCEL_GIT_COMMIT_SHA } = {}) {
  const result = { configured: false, applied: [], same: [], repoWins: [], errors: [], lineage: {} };
  const configured = typeof isConfigured === "function" ? isConfigured() : require("../supabase/env").isConfigured();
  if (!configured) return result;
  result.configured = true;
  const req = request || require("../supabase/client").request;

  let artifacts = [];
  try {
    artifacts = await store.listArtifacts({ request: req });
  } catch (error) {
    result.errors.push(`list: ${error.message}`);
    log(`[hydrate] eser listesi okunamadı, depo verisi kullanılıyor: ${error.message}`);
    return result;
  }

  const unchanged = gitAware ? gitUnchangedSince(root, headSha) : null;
  for (const artifact of artifacts) {
    try {
      store.assertDataPath(artifact.path);
      const file = path.join(root, artifact.path);
      const decision = store.artifactDecision(localSha(file), artifact, unchanged ? { unchangedSince: unchanged(artifact.path) } : {});
      if (decision === "repo-wins") { result.repoWins.push(artifact.path); continue; }
      if (decision === "apply") {
        const buffer = await store.readArtifact({ relPath: artifact.path, request: req });
        if (!buffer) continue;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.hydrate-${process.pid}`;
        fs.writeFileSync(tmp, buffer);
        fs.renameSync(tmp, file);
        result.applied.push(artifact.path);
      } else {
        result.same.push(artifact.path);
      }
      result.lineage[artifact.path] = store.nextLineage(artifact);
    } catch (error) {
      result.errors.push(`${artifact.path}: ${error.message}`);
    }
  }
  log(`[hydrate] uygulanan=${result.applied.length} aynı=${result.same.length} depo-kazandı=${result.repoWins.length} hata=${result.errors.length}`);
  return result;
}

module.exports = { hydrateDataDir, localSha, gitUnchangedSince };
