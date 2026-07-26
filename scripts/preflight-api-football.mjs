/**
 * API-FOOTBALL KURULUM ÖN KONTROLÜ
 *
 * Bu script tek bir soruyu yanıtlar: kadro senkronu şu anda gerçek veri
 * çekebilir mi, çekemiyorsa TAM OLARAK ne eksik?
 *
 * Neden ayrı bir script: eksik yapılandırma daha önce senkronun içinde,
 * güven verici tek bir cümleyle ve sıfır çıkış koduyla bildiriliyordu.
 * Sonuç, on üç takımın rapor sayfasının aylarca sessizce boş kalmasıydı.
 * Kontrol dışarı alınınca hem CI adımı senkrondan ÖNCE karar verebiliyor
 * hem de aynı teşhis yerelde tek komutla alınabiliyor.
 *
 * ANAHTAR GÜVENLİĞİ: anahtarın kendisi hiçbir çıktı yoluna girmez. Yalnızca
 * hangi değişkenin dolu olduğu, uzunluğu ve biçiminin geçerli görünüp
 * görünmediği yazılır. --probe ile canlı doğrulama yapıldığında bile
 * sağlayıcıya gönderilen başlık maskeli biçimde raporlanır.
 *
 * KULLANIM
 *   node scripts/preflight-api-football.mjs            # kontrol + lig kimliğini çöz
 *   node scripts/preflight-api-football.mjs --probe    # ek olarak anahtarı sağlayıcıya doğrulat
 *   node scripts/preflight-api-football.mjs --json     # makine okunur çıktı
 *
 * Anahtar tanımlıysa lig kimliği HER KOŞUDA çözülür ve sonuç
 * data/api-football-league.json'a yazılır; yani komut salt okunur değildir.
 * Çözümleme daha önce yalnızca --resolve ile yapılıyordu ve çözülmemiş
 * kimlik engel sayılmadığı için ön kontrol, kadro senkronunun duracağı bir
 * kurulumu "Hazır" gösteriyordu. --resolve hâlâ kabul edilir ama artık
 * bir şeyi değiştirmez.
 *
 * ÇIKIŞ KODU: yapılandırma eksikse 1, hazırsa 0. CI bu kodu değil, yazdığı
 * GitHub çıktısını (ready=true/false) kullanır — bkz. .github/workflows.
 */

import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const apiFootballProvider = require("../services/providers/apiFootballProvider.js");
const { resolveSuperLigLeagueId, CACHE_PATH } = require("../services/leagueResolver.js");

const args = new Set(process.argv.slice(2));
const wantProbe = args.has("--probe");
const wantResolve = args.has("--resolve") || wantProbe;
const asJson = args.has("--json");

const SETUP_STEPS = [
  "Vercel:          Project → Settings → Environment Variables → Add (Production + Preview)",
  "GitHub Actions:  Repo → Settings → Secrets and variables → Actions → New repository secret",
  "Yerel:           .env dosyasına yaz (.env git'e girmez, .gitignore'da)"
];

function line(text = "") {
  if (!asJson) console.log(text);
}

/** Anahtarın kendisi değil, yalnızca varlığı ve biçimi raporlanır. */
function inspectCredential() {
  const sources = apiFootballProvider.credentialSources();
  const config = apiFootballProvider.getConfig();

  return {
    present: Boolean(config.apiKey),
    envNames: sources.flatMap((row) => row.envNames || []),
    candidateCount: sources.length,
    formatValid: Boolean(config.apiKey) && apiFootballProvider.looksLikeApiKey(config.apiKey),
    length: config.apiKey ? config.apiKey.length : 0
  };
}

function missingKeyReport() {
  return {
    id: "APIFOOTBALL_API_KEY",
    title: "API anahtarı tanımlı değil",
    detail: "Kadro, oyuncu ve teknik ekip verisi bu anahtar olmadan çekilemez. " +
      "Kabul edilen değişken adları: " + [
        "APIFOOTBALL_API_KEY", "API_FOOTBALL_API_KEY", "APIFOOTBALL_KEY",
        "API_SPORTS_API_KEY", "APISPORTS_API_KEY"
      ].join(", ") + ".",
    fix: "Anahtarı https://dashboard.api-football.com adresinden al ve şu üç yere de tanımla:\n    " +
      SETUP_STEPS.join("\n    ")
  };
}

function malformedKeyReport(credential) {
  return {
    id: "APIFOOTBALL_API_KEY",
    title: "API anahtarı tanımlı ama biçimi beklenen gibi değil",
    detail: `Değer ${credential.envNames.join(", ")} değişkeninde ve ${credential.length} karakter. ` +
      "API-Sports anahtarları tam olarak 32 onaltılık karakterdir. Genellikle eksik kopyalanmış, " +
      "tırnak içinde kalmış ya da başına/sonuna boşluk yapışmış olur.",
    fix: "Değeri panodan tırnaksız ve boşluksuz yeniden yapıştır. Doğrulamak için: " +
      "node scripts/preflight-api-football.mjs --probe"
  };
}

function unresolvedLeagueReport(resolution) {
  const shared = {
    id: "APIFOOTBALL_LEAGUE_ID",
    fix: "Kimliği elle tanımlamak için APIFOOTBALL_LEAGUE_ID değişkenini şu üç yere ekle:\n    " +
      SETUP_STEPS.join("\n    ")
  };

  if (resolution.reason === "no-api-key") {
    return {
      ...shared,
      title: "Lig kimliği çözülemedi (anahtar yok)",
      detail: "Lig kimliği bilerek koda gömülmedi; anahtar olmadan sağlayıcıya sorulamaz. " +
        "Anahtar tanımlandığında bu adım kendiliğinden çözülür, elle tanımlamak gerekmez."
    };
  }

  if (resolution.reason === "ambiguous-match") {
    return {
      ...shared,
      title: "Lig kimliği belirsiz — birden fazla eşleşme var",
      detail: "Sağlayıcı aynı isimle birden fazla lig döndürdü. Yanlış ligi seçmek, on sekiz takımın " +
        "kadrosunu yanlış ligden doldurup bunu doğrulanmış veri gibi yayımlardı; bu yüzden tahmin " +
        "edilmiyor. Adaylar:\n" +
        resolution.candidates.map((item) => `      ${item.id}  ${item.name} (${item.country})`).join("\n")
    };
  }

  if (resolution.reason === "no-match") {
    return {
      ...shared,
      title: "Lig kimliği çözülemedi — katalogda Süper Lig bulunamadı",
      detail: "Sağlayıcı bu ülke/sezon için Süper Lig döndürmedi. Genellikle paketin ilgili sezona " +
        "erişimi olmadığı anlamına gelir." +
        (resolution.candidates.length
          ? "\n    Sağlayıcının döndürdüğü ligler:\n" +
            resolution.candidates.slice(0, 15).map((item) => `      ${item.id}  ${item.name} (${item.country})`).join("\n")
          : "")
    };
  }

  return {
    ...shared,
    title: "Lig kimliği çözülemedi",
    detail: `Sağlayıcı çağrısı başarısız oldu: ${resolution.reason}. ` +
      "Anahtar geçerliyse bu genellikle paket kısıtı ya da geçici bir sağlayıcı hatasıdır. " +
      "Ayrıntı için: node scripts/preflight-api-football.mjs --probe"
  };
}

/** probeCredentials verdict'lerinin okunur karşılıkları. */
const VERDICT_LABELS = {
  ACCEPTED: "kabul edildi",
  ACCEPTED_NO_DETAIL: "kabul edildi (plan ayrıntısı dönmedi)",
  REJECTED: "reddedildi",
  HTTP_ERROR: "HTTP hatası",
  TRANSPORT_ERROR: "bağlantı kurulamadı"
};

function verdictLabel(candidate) {
  const label = VERDICT_LABELS[candidate.verdict] || candidate.verdict || "bilinmeyen sonuç";
  if (candidate.verdict === "REJECTED" && candidate.apiErrors) {
    const detail = Array.isArray(candidate.apiErrors)
      ? candidate.apiErrors.join("; ")
      : Object.values(candidate.apiErrors).join("; ");
    return `${label} — ${String(detail).slice(0, 120)}`;
  }
  if (candidate.verdict === "TRANSPORT_ERROR" && candidate.transportError) {
    return `${label} — ${candidate.transportError}`;
  }
  return label;
}

/**
 * GitHub koşu özeti. Anahtar hiçbir biçimde yazılmaz — yalnızca eksik
 * değişkenin ADI, gerekçesi ve nereye tanımlanacağı.
 */
function writeStepSummary(ready, blockers, resolution) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;

  const lines = ready
    ? [
      "### ✅ API-Football yapılandırması hazır",
      "",
      `Lig kimliği: \`${resolution.leagueId}\` (${resolution.source})`,
      "",
      "Kadro senkronu bu koşuda gerçek veriyle çalışacak."
    ]
    : [
      "### ⚠️ API-Football yapılandırması eksik — kadro senkronu atlandı",
      "",
      "Sahte kadro üretilmedi; eksik veriyle sayfa doldurulmadı.",
      "",
      ...blockers.flatMap((blocker) => [
        `**${blocker.title}** — \`${blocker.id}\``,
        "",
        blocker.detail,
        "",
        blocker.fix,
        ""
      ]),
      "Ayrıntılı kurulum: `docs/api-football-setup.md`",
      "",
      "Secret eklendiğinde kod değişikliği gerekmez; bir sonraki koşuda bu adım " +
        "kendiliğinden gerçek veriyle çalışır."
    ];

  try {
    fs.appendFileSync(file, `${lines.join("\n")}\n`, "utf8");
  } catch {
    /* Özet yazılamazsa ön kontrol yine çalışır; yalnızca rapor kaybolur. */
  }
}

function printBlockers(blockers) {
  line("");
  line("API-Football yapılandırması EKSİK — kadro senkronu çalıştırılmayacak.");
  line("Sahte kadro üretilmiyor; eksik veriyle sayfa doldurulmuyor.");
  line("");

  blockers.forEach((blocker, index) => {
    line(`  ${index + 1}. ${blocker.title}  [${blocker.id}]`);
    line(`     ${blocker.detail.split("\n").join("\n     ")}`);
    line(`     Çözüm: ${blocker.fix.split("\n").join("\n     ")}`);
    line("");
  });

  line("Ayrıntılı kurulum: docs/api-football-setup.md");
  line("");
}

async function main() {
  const config = apiFootballProvider.getConfig();
  const credential = inspectCredential();
  const blockers = [];

  line("API-Football ön kontrolü");
  line("------------------------");
  line(`  Anahtar        : ${credential.present ? `tanımlı (${credential.envNames.join(", ")})` : "TANIMLI DEĞİL"}`);
  if (credential.present) {
    line(`  Anahtar biçimi : ${credential.formatValid ? "geçerli görünüyor" : `beklenmedik (${credential.length} karakter)`}`);
  }
  line(`  Temel adres    : ${config.baseUrl}`);
  // Sezon takma adlarla da tanımlanabilir; tek bir ismi kontrol etmek
  // env'den gelen bir değeri "tarihten türetildi" diye yanlış etiketliyordu.
  const seasonFromEnv = ["APIFOOTBALL_SEASON", "API_FOOTBALL_SEASON"]
    .find((name) => String(process.env[name] || "").trim() !== "");
  line(`  Sezon          : ${config.season}${seasonFromEnv ? ` (${seasonFromEnv})` : " (tarihten türetildi)"}`);

  if (!credential.present) blockers.push(missingKeyReport());
  else if (!credential.formatValid) blockers.push(malformedKeyReport(credential));

  // Lig kimliği: env → önbellek → sağlayıcı.
  //
  // Anahtar varken çözümleme HER ZAMAN denenir. Daha önce yalnızca --resolve
  // ile deneniyordu ve çözülmemiş kimlik engel sayılmadığı için ön kontrol
  // "Hazır" diyordu — teşhis aracı, kadro senkronunun duracağı bir kurulumu
  // sağlam gösteriyordu. Çağrı bir kez yapılır, sonuç önbelleğe yazılır.
  const resolution = credential.present
    ? await resolveSuperLigLeagueId()
    : { status: "unavailable", leagueId: null, source: null, reason: "no-api-key", candidates: [] };

  if (resolution.status === "resolved") {
    // Yalnızca çözülen kimlik basılır.
    line(`  Lig kimliği    : ${resolution.leagueId} (${resolution.source})`);
  } else if (!credential.present) {
    line("  Lig kimliği    : anahtar tanımlanınca otomatik çözülecek");
    // Anahtar zaten engel olarak listelendi; ikinci kez rapor edilmez.
  } else {
    line("  Lig kimliği    : ÇÖZÜLEMEDİ");
    blockers.push(unresolvedLeagueReport(resolution));
  }

  if (wantProbe && credential.present) {
    line("");
    line("  Sağlayıcı doğrulaması (--probe)");
    const probe = await apiFootballProvider.probeCredentials();

    // Anahtarın VAR OLMASI, KULLANILABİLİR olması demek değil. İptal edilmiş,
    // askıya alınmış ya da limiti dolmuş bir anahtar kapıyı açar, ardından
    // kadro senkronu ilk çağrıda düşer ve aynı doğrusal zincirdeki maç
    // sonucu senkronuyla site derlemesini de yanında götürürdü. Lig kimliği
    // env'den ya da önbellekten geldiğinde çözümleme hiç ağa çıkmadığı için
    // bu tek doğrulama noktası.
    const accepted = (probe.candidates || []).filter((candidate) =>
      candidate.verdict === "ACCEPTED" || candidate.verdict === "ACCEPTED_NO_DETAIL");

    if (!accepted.length) {
      blockers.push({
        id: "APIFOOTBALL_API_KEY",
        title: "Anahtar tanımlı ama sağlayıcı kabul etmiyor",
        detail: "Anahtar gönderildi ve reddedildi. En sık sebepler: iptal edilmiş anahtar, askıya alınmış " +
          "hesap, paketin ilgili sezona erişmemesi ya da günlük limitin dolması. Aşağıdaki satırlar " +
          "sağlayıcının her aday için verdiği yanıtı gösteriyor.",
        fix: "Panelden (https://dashboard.api-football.com) anahtarın durumunu ve plan kapsamını " +
          "kontrol et; gerekiyorsa yeni anahtarı üç ortama da yeniden tanımla."
      });
    }

    for (const candidate of probe.candidates || []) {
      // probeCredentials'ın gerçek alanı `verdict`. Daha önce burada olmayan
      // bir `ok` alanı okunuyordu ve GEÇERLİ bir anahtar "reddedildi" diye
      // raporlanıyordu — teşhis aracının kendisi yanlış cevap veriyordu.
      // maskedKey sağlayıcı katmanında maskelenir; ham anahtar buraya gelmez.
      line(`    ${candidate.envNames.join(", ")}: HTTP ${candidate.httpStatus ?? "-"} ` +
        `${verdictLabel(candidate)} (${candidate.maskedKey})`);
    }
  }

  const ready = blockers.length === 0;

  if (asJson) {
    console.log(JSON.stringify({
      ready,
      leagueId: resolution.status === "resolved" ? resolution.leagueId : null,
      leagueIdSource: resolution.status === "resolved" ? resolution.source : null,
      season: config.season,
      credentialPresent: credential.present,
      credentialFormatValid: credential.formatValid,
      blockers: blockers.map((item) => ({ id: item.id, title: item.title }))
    }, null, 2));
  } else if (ready) {
    line("");
    line("Hazır: kadro senkronu gerçek veriyle çalışabilir.");
    line("");
  } else {
    printBlockers(blockers);
  }

  // CI bu dosyaya yazarak sonraki adımları koşullandırır.
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `ready=${ready}\n`, "utf8");
    if (resolution.status === "resolved") {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `league_id=${resolution.leagueId}\n`, "utf8");
    }
  }

  if (!ready && process.env.GITHUB_ACTIONS === "true") {
    console.log(`::warning::API-Football yapılandırması eksik (${blockers.map((item) => item.id).join(", ")}); ` +
      "kadro senkronu atlandı. Sahte veri üretilmedi.");
  }

  // Koşu özetini bu adım yazmalı: kadro senkronu kapı kapalıyken hiç
  // çalışmıyor, dolayısıyla oradaki özet yazıcısına ulaşılmıyor. Özet
  // yazılmasaydı "koşu özeti neyin eksik olduğunu söyler" iddiası boşta
  // kalırdı — operatör yalnızca sessizce atlanmış adımlar görürdü.
  writeStepSummary(ready, blockers, resolution);

  process.exitCode = ready ? 0 : 1;
}

main().catch((error) => {
  // Hata nesnesi anahtar taşımaz; sağlayıcı katmanı yalnızca kod ve mesaj döner.
  const message = error && error.message ? error.message : String(error);
  console.error(`Ön kontrol beklenmedik şekilde başarısız oldu: ${message}`);

  // Çöken bir ön kontrol, kapıyı kapalı bırakır (çıktı yazılmadığı için
  // karşılaştırma 'true' ile eşleşmez) — doğru yön. Ama sessizce çökerse
  // operatör kadroların neden güncellenmediğini göremez; koşu sağlıklı
  // görünür. Bu yüzden çökme de görünür bir uyarı üretir.
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::warning::API-Football ön kontrolü çöktü: ${message.slice(0, 200)}. ` +
      "Kadro senkronu atlandı; sahte veri üretilmedi.");
  }

  if (process.env.GITHUB_OUTPUT) {
    try {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, "ready=false\n", "utf8");
    } catch {
      /* Çıktı yazılamazsa kapı yine kapalı kalır: boş değer 'true' değildir. */
    }
  }

  process.exitCode = 1;
});
