/**
 * ÜRETİLEN VERİYİ HAREKETLİ BİR DALA GÜVENLE İTER.
 *
 * SORUN. İki iş de üretilmiş veriyi `main`'e düz `git push` ile itiyordu:
 *
 *     git add -A && git commit -m "..." && git push
 *
 * `git push` yalnızca uzak dal, işin checkout aldığı yerde DURUYORSA çalışır.
 * Canlı yenileme işi beş dakikada bir koştuğu için, checkout ile push arasında
 * `main`'e düşen her commit — bir PR merge'ü yeter — koşuyu düşürüyordu:
 *
 *     ! [rejected]  main -> main (fetch first)
 *     error: failed to push some refs
 *
 * Gerçek bir olayda tam olarak bu yaşandı (run 121): iş veriyi tazeledi,
 * commit'i attı, sonra bir merge yüzünden push reddedildi ve koşu kırmızıya
 * döndü. Tazelenen veri de kayboldu — üstelik ortada bozuk hiçbir şey yoktu.
 *
 * ÇÖZÜM. Reddedilen push bir hata değil, bir YARIŞ. Uzak dalın son hâli
 * alınır, commit onun üzerine taşınır (rebase) ve yeniden denenir.
 *
 * NEDEN REBASE, NEDEN `--force` DEĞİL. Bu iş `main`'e yazıyor; zorla itmek
 * araya giren insan commit'ini yok ederdi. Rebase ise bizim commit'imizi en
 * üste taşır ve başkasının işine dokunmaz.
 *
 * ÇAKIŞMADA NE OLUR. Çakışma, iki tarafın da AYNI üretilmiş dosyayı
 * değiştirdiği anlamına gelir. Üretilmiş bir dosyada "hangi taraf haklı"
 * sorusunun anlamlı bir cevabı yok: doğru çıktı, en güncel girdilerden
 * yeniden üretilendir. Bu yüzden birleştirme UYDURULMAZ — rebase iptal
 * edilir, durum açıkça bildirilir ve bu koşunun çıktısı düşürülür. Veri
 * türetilmiş olduğu için kalıcı bir kayıp değil: sonraki koşu (en geç beş
 * dakika sonra) temiz bir checkout'tan yeniden üretir.
 *
 * ÇIKIŞ KODU 0. Ertelenen bir koşu çökmüş bir koşu değildir; kendi kendini
 * onaran geçici bir yarış için CI'ı kırmızıya boyamak, düzeltmeye çalıştığı
 * sorunun ta kendisi olurdu.
 *
 * AMA "GEÇİCİ" VARSAYIMI BİR KEZ TUTMADI. 19 Eylül 20:40'tan 20 Eylül öğlene
 * kadar saatlik koşuların HEPSİ ertelendi: her koşu veriyi tazeledi, 16 bin
 * dosya üretti ve çakışma yüzünden hiçbirini yazamadı. İz yalnızca koşu
 * günlüğünün içindeki bir satırdı; iş akışı yeşil göründüğü için kimse fark
 * etmedi ve site 17 saat boyunca bitmiş maçları "oynanacak" gösterdi.
 * Sebep ayrıca giderildi (main'e yazan bütün işler artık tek bir eşzamanlılık
 * kuyruğunda), ama erteleme artık GitHub'ın kendi uyarı akışına da düşüyor:
 * koşu özetinde görünür, aranabilir ve tekrar ederse gözden kaçmaz.
 *
 * Kullanım:
 *   node scripts/ci-commit-push.mjs "ci(matches): ..."
 */
import { execFileSync } from "node:child_process";

/** Commit yazarı. Bu kimlik BİLEREK repo sahibinin hesabı. */
const AUTHOR_NAME = "ugursivrikaya22";
// Vercel, dağıtımı tetikleyen commit'in yazarını bir GitHub hesabına eşler
// ve o hesabın projeye katkı erişimi yoksa dağıtımı reddeder; Hobby planı
// özel repolarda ek üye kabul etmediği için "futbolradar-bot" gibi ayrı bir
// kimlikle atılan her commit dağıtımı bloke eder. Bu adres ugursivrikaya22
// hesabının GitHub noreply adresi (kullanıcı kimliği 295430257), yani commit
// doğrudan o hesaba atfedilir ve gizli bir e-posta sızdırmaz.
const AUTHOR_EMAIL = "295430257+ugursivrikaya22@users.noreply.github.com";

/** Kaç kez denensin? Yarışın üst üste üç kez olması pratikte görülmedi. */
const MAX_ATTEMPTS = 3;

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"]
  });
}

/** Çıkış kodunu hataya çevirmeden çalıştırır. */
function tryGit(args) {
  try {
    const stdout = git(args);
    return { ok: true, stdout: String(stdout || "") };
  } catch (error) {
    return {
      ok: false,
      stdout: String((error && error.stdout) || ""),
      stderr: String((error && error.stderr) || error.message || "")
    };
  }
}

function log(message) {
  console.log(`[ci-push] ${message}`);
}

/**
 * Ertelemeyi GitHub'ın uyarı akışına düşürür: koşu özetinin başında görünür
 * ve iş akışı listesinden aranabilir. Actions dışında (yerelde) sıradan bir
 * satır olarak yazılır — kontrol dizisi kullanıcıya çöp göstermesin.
 */
function annotate(message) {
  const oneLine = String(message).replace(/\r?\n/g, " ");
  if (process.env.GITHUB_ACTIONS === "true") console.log(`::warning title=ci-push ertelendi::${oneLine}`);
  else console.warn(`[ci-push] UYARI: ${oneLine}`);
}

const message = process.argv[2];

if (!message || !message.trim()) {
  console.error("[ci-push] commit mesajı gerekli: node scripts/ci-commit-push.mjs \"ci(...): ...\"");
  process.exit(1);
}

git(["config", "user.name", AUTHOR_NAME]);
git(["config", "user.email", AUTHOR_EMAIL]);

const status = git(["status", "--porcelain"]).trim();

if (!status) {
  log("değişiklik yok, commit atılmadı.");
  process.exit(0);
}

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();

if (!branch || branch === "HEAD") {
  // Ayrık HEAD'de push edilecek bir dal yok. Zorla bir dal adı UYDURMAK,
  // yanlış dala yazma riski taşır.
  console.error("[ci-push] ayrık HEAD; itilecek dal belirlenemedi. Hiçbir şey yapılmadı.");
  process.exit(1);
}

const changedCount = status.split("\n").filter(Boolean).length;
log(`${changedCount} dosya değişti · dal: ${branch}`);

git(["add", "-A"]);
git(["commit", "-m", message]);

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  const push = tryGit(["push", "origin", `HEAD:${branch}`]);

  if (push.ok) {
    log(`itildi (deneme ${attempt}/${MAX_ATTEMPTS}).`);
    process.exit(0);
  }

  log(`push reddedildi (deneme ${attempt}/${MAX_ATTEMPTS}): ${push.stderr.trim().split("\n").pop()}`);

  if (attempt === MAX_ATTEMPTS) break;

  const fetched = tryGit(["fetch", "origin", branch]);
  if (!fetched.ok) {
    log(`fetch başarısız: ${fetched.stderr.trim()}`);
    continue;
  }

  const rebase = tryGit(["rebase", `origin/${branch}`]);

  if (rebase.ok) {
    log(`commit ${branch} dalının son hâlinin üzerine taşındı; yeniden deneniyor.`);
    continue;
  }

  // ÇAKIŞMA. Üretilmiş dosyada taraf seçmek uydurma bir durum yaratır.
  tryGit(["rebase", "--abort"]);
  annotate("Üretilmiş dosyada çakışma: bu koşunun tazelenmiş çıktısı yazılmadı.");
  console.warn(
    `[ci-push] ERTELENDİ: ${branch} dalında çakışma var, bu koşunun çıktısı yazılmadı.\n` +
    "[ci-push] Üretilmiş dosyada taraf seçilmez; doğru çıktı en güncel girdilerden\n" +
    "[ci-push] yeniden üretilendir. Sonraki koşu temiz bir checkout'tan üretecek.\n" +
    `[ci-push] Çakışan yol(lar): ${rebase.stdout.trim().split("\n").filter((line) => /CONFLICT/.test(line)).join(" | ") || "git bildirmedi"}`
  );
  process.exit(1);
}

annotate(`${MAX_ATTEMPTS} denemede itilemedi: bu koşunun tazelenmiş çıktısı yazılmadı.`);
console.warn(
  `[ci-push] ERTELENDİ: ${MAX_ATTEMPTS} denemede itilemedi (${branch} sürekli güncelleniyor).\n` +
  "[ci-push] Veri türetilmiş olduğu için kayıp kalıcı değil; sonraki koşu yeniden üretecek."
);
process.exit(1);
