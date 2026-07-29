/**
 * RADAR PUANI (0-100) — tek yetkili kural.
 *
 * Klasik canlı skor siteleri maçları saate göre dizer. Saat, maçın ne kadar
 * ilgi çekici olduğu hakkında hiçbir şey söylemez: aynı anda başlayan bir
 * derbi ile bir hazırlık maçı listede yan yana durur.
 *
 * Radar Puanı dört ölçüyü tek sayıda birleştirir:
 *
 *   ÖNEM            Kim oynuyor, hangi turnuvada (services/matchPriorityService.js)
 *   MAÇ DURUMU      Canlı mı, bitti mi, başlayacak mı (services/matchEligibility.js)
 *   SÜRPRİZ         Ölçülen form, isim farkıyla ne kadar çelişiyor
 *   VERİ KAPSAMI    Bu maç hakkında ne kadar şey söyleyebiliyoruz
 *
 * PUAN KENDİ KAPSAMINI TAŞIR — bu dosyanın en önemli kuralı.
 *
 * Bileşenlerin hepsi her maçta ölçülemez. Depodaki 18 takımın yalnızca
 * beşinde sayısal form var (momentum/formScore); geri kalanında sürpriz
 * ihtimali HESAPLANAMAZ. Ölçülemeyen bileşene sıfır vermek, "sürpriz
 * ihtimali yok" demek olurdu — oysa doğru cümle "bilmiyoruz". Bu yüzden
 * puan yalnızca ÖLÇÜLEN bileşenler üzerinden hesaplanır ve yanında kaç
 * puanlık ölçüye dayandığı (`coverage`) taşınır.
 *
 * Yani 82 puanlık iki maçtan biri dört ölçüye, diğeri ikisine dayanıyor
 * olabilir; okuyucu bunu görebilmeli. Tek bir sayının arkasındaki belirsizliği
 * gizlemek, sayının kendisini uydurmak kadar yanıltıcıdır.
 *
 * TAHMİN DEĞİLDİR. Puan bir sonuç iddiası taşımaz, oran üretmez, hangi takımın
 * kazanacağını söylemez. Yalnızca "bu maça bakmaya değer mi?" sorusunu
 * ölçülmüş verilerle cevaplar.
 */

const { matchPriority } = require("./matchPriorityService.js");
const { clubPopularity } = require("./matchPriorityService.js");
const { evaluateDisplayable } = require("./matchEligibility.js");

/**
 * Bileşen ağırlıkları. Toplamı 100.
 *
 * Önem en ağır: okuyucu ana sayfaya önce "büyük maç var mı?" diye bakar.
 * Sürpriz en hafif, çünkü elimizdeki form verisi en dar kapsamlı olan.
 */
const COMPONENTS = Object.freeze([
  { id: "importance", weight: 45, label: "Önem" },
  { id: "scoreStatus", weight: 30, label: "Maç durumu" },
  { id: "coverage", weight: 25, label: "Veri kapsamı" }
]);

/**
 * SÜRPRİZ AYRI DURUR: ÇEKİRDEĞE DEĞİL, ÜSTÜNE EKLENİR.
 *
 * Önce ağırlıklı ortalamanın içindeydi ve bu ters bir teşvik yaratıyordu:
 * formu ÖLÇÜLEN iki takım düşük sürpriz alıp puanını düşürebiliyor, formu
 * ölçülmeyen bir eşleşme ise cezalanmadığı için öne geçiyordu. Yani daha çok
 * veriye sahip olmak puanı DÜŞÜRÜYORDU.
 *
 * Anlamı da bonusa uyuyor: bir maç sürpriz ihtimali yok diye daha az izlenesi
 * olmaz; sürpriz ihtimali varsa daha çok izlenesi olur. Bu yüzden sürpriz
 * yalnızca YUKARI ekler, aşağı çekmez.
 */
const SURPRISE_BONUS_MAX = 15;
const SURPRISE_COMPONENT = Object.freeze({ id: "surprise", weight: SURPRISE_BONUS_MAX, label: "Sürpriz ihtimali" });

/**
 * Yapısal önem bu değere ulaştığında önem bileşeni doyar.
 *
 * Değer, canlılık bonusu ÇIKARILDIKTAN sonraki gerçek tavana göre seçildi:
 * bir Galatasaray-Fenerbahçe derbisi 322, Avrupa'da oynayan bir Türk takımı
 * ~308, Süper Lig'in orta sıra eşleşmesi ~150 puan alıyor. 350, en büyük
 * maçı doyuma yaklaştırırken sıradan maçları ayırt edilebilir bırakıyor.
 */
const IMPORTANCE_SATURATION = 350;

/** Maç durumu değerleri. Canlı maç her zaman en yüksek. */
const STATUS_VALUE = Object.freeze({
  live: 100,
  "unknown-status": 80,
  finished: 65,
  upcoming: 45
});

/** formScore ölçeği (0-10). Depodaki değerler bu aralıkta. */
const FORM_SCALE = 10;

/** Kapsam eşikleri: puanın ne kadar ölçüye dayandığı. */
const CONFIDENCE_BANDS = Object.freeze([
  { min: 75, level: "high", label: "Yüksek kapsam" },
  { min: 50, level: "medium", label: "Orta kapsam" },
  { min: 0, level: "low", label: "Sınırlı kapsam" }
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function teamRecord(name, teams) {
  if (!name || !Array.isArray(teams)) return null;
  const key = String(name).toLocaleLowerCase("tr-TR").trim();
  return teams.find((team) => String(team && team.name || "").toLocaleLowerCase("tr-TR").trim() === key) || null;
}

/** Ölçülemeyen bileşen: sıfır değil, AÇIKÇA ölçülmemiş. */
function unmeasured(id, label, weight, basis) {
  return { id, label, weight, value: null, measured: false, basis };
}

function measured(id, label, weight, value, basis) {
  return { id, label, weight, value: clamp(Math.round(value), 0, 100), measured: true, basis };
}

/** ÖNEM: kim oynuyor, hangi turnuvada. Takım adları bilindiği sürece ölçülür. */
function importanceComponent(match, options, spec) {
  // ignoreStatus: canlılık/gün bonusu ÇIKARILIR. Maç durumu ayrı bir bileşen;
  // iki yerde sayılsaydı canlı bir alt sıra maçı bir derbinin üstüne çıkardı
  // ve ağırlıklar iddia ettikleri şeyi ölçmezdi.
  const priority = matchPriority(match, { ...options, ignoreStatus: true });
  const value = (priority.score / IMPORTANCE_SATURATION) * 100;

  // primaryReason bir NESNE ({key,label}); doğrudan yazılırsa karta
  // "[object Object]" basılır. Gerekçe metni etiketten okunur.
  const reason = priority.primaryReason && priority.primaryReason.label;
  const basis = reason || priority.competition || "Kulüp ve turnuva ağırlığı";
  return measured(spec.id, spec.label, spec.weight, value, basis);
}

/** MAÇ DURUMU: canlı > durumu geç gelmiş > bitmiş > başlayacak. */
function scoreStatusComponent(match, options, spec) {
  const verdict = evaluateDisplayable(match, options.now);
  if (!verdict.displayable) {
    return unmeasured(spec.id, spec.label, spec.weight, "Maç gösterilebilir durumda değil");
  }

  const value = STATUS_VALUE[verdict.phase];
  if (value === undefined) {
    return unmeasured(spec.id, spec.label, spec.weight, `Tanınmayan maç evresi: ${verdict.phase}`);
  }

  const basis = verdict.phase === "live" ? "Maç sürüyor"
    : verdict.phase === "finished" ? "Maç tamamlandı"
    : verdict.phase === "upcoming" ? "Başlama saati bekleniyor"
    : "Skor geldi, durum etiketi bekleniyor";
  return measured(spec.id, spec.label, spec.weight, value, basis);
}

/**
 * SÜRPRİZ İHTİMALİ.
 *
 * Tanım: ÖLÇÜLEN FORM, İSİM FARKIYLA NE KADAR ÇELİŞİYOR?
 *
 * İki büyük kulüp eşit formda oynuyorsa sürpriz beklenmez — güçler zaten
 * denk. Sürpriz, isim olarak geride olan tarafın formda geride OLMAMASIdır.
 * Bu yüzden ölçü iki farkın çelişkisi:
 *
 *   isimFarkı büyük + formFarkı küçük        -> yüksek sürpriz ihtimali
 *   isim olarak zayıf taraf formda önde      -> en yüksek
 *   isim ve form aynı yöne işaret ediyor     -> düşük
 *
 * BİR TAHMİN DEĞİLDİR: kimin kazanacağını söylemez, olasılık üretmez.
 * Yalnızca "bu maçta beklenmedik bir şey olma ihtimali ölçülebilir mi?"
 * sorusunu ölçülmüş form verisiyle cevaplar.
 *
 * İki takımın da sayısal formu yoksa HESAPLANMAZ. Depodaki 18 takımın
 * yalnızca beşinde bu veri var; kalanına sıfır vermek "sürpriz yok" demek
 * olurdu ve bu ölçülmemiş bir iddia olurdu.
 */
function surpriseComponent(match, options, spec) {
  const teams = Array.isArray(options.teams) ? options.teams : [];
  const home = teamRecord(match && match.homeTeam, teams);
  const away = teamRecord(match && match.awayTeam, teams);

  const homeForm = numeric(home && home.formScore);
  const awayForm = numeric(away && away.formScore);

  if (homeForm === null || awayForm === null) {
    const missing = [homeForm === null ? (match && match.homeTeam) : null,
      awayForm === null ? (match && match.awayTeam) : null].filter(Boolean);
    return unmeasured(spec.id, spec.label, spec.weight,
      `Form ölçüsü yok: ${missing.join(", ") || "takım kaydı bulunamadı"}`);
  }

  const homePopularity = clubPopularity(match && match.homeTeam);
  const awayPopularity = clubPopularity(match && match.awayTeam);

  // İsim farkı 0-1: iki kulübün bilinirlik farkı.
  const popularityGap = Math.abs(homePopularity - awayPopularity) / 100;
  // Form farkı 0-1: ölçülen form farkı.
  const formGap = Math.abs(homeForm - awayForm) / FORM_SCALE;

  // Temel: isim farkı büyükken form farkı küçükse sürpriz ihtimali yüksek.
  let value = popularityGap * (1 - formGap) * 100;

  // İsim olarak geride olan taraf FORMDA ÖNDEYSE bu, çelişkinin en güçlü
  // hâli — ölçülen veri, beklentinin tersini söylüyor.
  const underdogIsHome = homePopularity < awayPopularity;
  const underdogLeadsForm = underdogIsHome ? homeForm > awayForm : awayForm > homeForm;
  if (underdogIsHome !== (homePopularity === awayPopularity) && underdogLeadsForm) {
    value = Math.min(100, value + formGap * 100);
  }

  const basis = `${match.homeTeam} form ${homeForm} · ${match.awayTeam} form ${awayForm}`;
  return measured(spec.id, spec.label, spec.weight, value, basis);
}

/**
 * VERİ KAPSAMI: bu maç hakkında ne kadar şey söyleyebiliyoruz?
 *
 * Kapsamı yüksek maç listede yükselir, çünkü okuyucu tıkladığında karşısına
 * dolu bir sayfa çıkar. Kapsam ölçülemiyorsa bileşen hesaba KATILMAZ —
 * "kapsam sıfır" ile "kapsamı bilmiyoruz" aynı şey değil.
 */
function coverageComponent(match, options, spec) {
  const report = options.report;
  if (report && report.stageCoverage && numeric(report.stageCoverage.overall) !== null) {
    return measured(spec.id, spec.label, spec.weight, Number(report.stageCoverage.overall),
      `Maç raporu kapsamı %${Math.round(report.stageCoverage.overall)}`);
  }

  const analysis = options.analysis;
  const analysisCoverage = analysis && analysis.coverage && numeric(analysis.coverage.overallCoverage);
  if (analysisCoverage !== null && analysisCoverage !== undefined) {
    return measured(spec.id, spec.label, spec.weight, Number(analysisCoverage),
      `Maç öncesi analiz kapsamı %${Math.round(analysisCoverage)}`);
  }

  return unmeasured(spec.id, spec.label, spec.weight, "Bu maç için kapsam ölçüsü yok");
}

const BUILDERS = Object.freeze({
  importance: importanceComponent,
  scoreStatus: scoreStatusComponent,
  coverage: coverageComponent
});

function confidenceOf(coverage) {
  return CONFIDENCE_BANDS.find((band) => coverage >= band.min) || CONFIDENCE_BANDS.at(-1);
}

/**
 * Bir maçın Radar Puanı.
 *
 * @param {object} match
 * @param {{now?: Date, teams?: Array, analysis?: object, report?: object}} [options]
 * @returns {{score: number|null, coverage: number, confidence: string,
 *   confidenceLabel: string, components: Array, reasons: Array<string>}}
 */
function radarScore(match, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const context = { ...options, now };

  // PUANLANAN <=> GÖSTERİLEBİLEN.
  //
  // Radar Puanı okuyucunun GÖRECEĞİ şeyleri sıralamak için var. Gösterilemeyen
  // bir maça puan vermek — skoru gelmemiş, saati okunamayan bir kayıt —
  // sıralanabilir ama çizilemez bir satır üretirdi. Görünürlüğün tek yetkilisi
  // görüntüleme kapısı (services/matchEligibility.js); burada tekrar
  // yorumlanmıyor, olduğu gibi kabul ediliyor.
  const visibility = evaluateDisplayable(match, now);
  if (!visibility.displayable) {
    return {
      score: null,
      coverage: 0,
      confidence: "low",
      confidenceLabel: "Gösterilemiyor",
      components: COMPONENTS.map((spec) =>
        unmeasured(spec.id, spec.label, spec.weight, "Maç gösterilebilir durumda değil")),
      reasons: [`Maç şu anda gösterilemiyor: ${visibility.reason || "gerekçe yok"}`]
    };
  }

  const core = COMPONENTS.map((spec) => BUILDERS[spec.id](match, context, spec));
  const surprise = { ...surpriseComponent(match, context, SURPRISE_COMPONENT), bonus: true };
  const components = [...core, surprise];
  const measuredComponents = core.filter((component) => component.measured);

  // Ölçülen ÇEKİRDEK ağırlık toplamı = puanın kapsamı. Sürpriz bir bonus
  // olduğu için kapsama girmez; ölçülüp ölçülmediği kendi alanında duruyor.
  const coverage = measuredComponents.reduce((total, component) => total + component.weight, 0);

  if (!measuredComponents.length) {
    return {
      score: null,
      coverage: 0,
      confidence: "low",
      confidenceLabel: "Ölçü yok",
      components,
      reasons: ["Bu maç için ölçülmüş hiçbir bileşen yok; puan üretilmedi."]
    };
  }

  // YENİDEN NORMALLEŞTİRME: ölçülemeyen bileşen puanı aşağı çekmez, yalnızca
  // kapsamı düşürür. Aksi hâlde form verisi olmayan her maç, veri eksikliği
  // yüzünden "önemsiz" görünürdü.
  const weighted = measuredComponents.reduce(
    (total, component) => total + component.value * component.weight, 0);
  const base = weighted / coverage;

  // Sürpriz yalnızca yukarı ekler. Ölçülemediğinde bonus sıfırdır ve bu bir
  // ceza değildir — maç kendi çekirdek puanında kalır.
  const bonus = surprise.measured ? (surprise.value / 100) * SURPRISE_BONUS_MAX : 0;
  const score = Math.round(base + bonus);

  const band = confidenceOf(coverage);
  const reasons = measuredComponents
    .slice()
    .sort((left, right) => (right.value * right.weight) - (left.value * left.weight))
    .slice(0, 2)
    .map((component) => `${component.label}: ${component.basis}`);

  if (surprise.measured && surprise.value > 0) {
    reasons.push(`${surprise.label}: ${surprise.basis}`);
  }

  const unmeasuredComponents = components.filter((component) => !component.measured);
  if (unmeasuredComponents.length) {
    reasons.push(`Ölçülemeyen bileşen: ${unmeasuredComponents.map((item) => item.label).join(", ")}`);
  }

  return {
    score: clamp(score, 0, 100),
    coverage,
    confidence: band.level,
    confidenceLabel: band.label,
    components,
    reasons
  };
}

/**
 * Maçları Radar Puanına göre sıralar.
 *
 * VARSAYILAN OLARAK EVRE BANDI ÖNCE GELİR. Bu bilinçli: "canlı maç üstte,
 * sonra biten, sonra başlayacak" kuralı ayrı ve açık bir karardı
 * (services/matchEligibility.js orderForDisplay). Radar Puanı o bandın
 * İÇİNDE sıralar. `pureScore: true` verilirse bant yok sayılır ve yalnızca
 * puan belirler — o zaman önemli bir başlayacak maç, önemsiz bir canlı maçın
 * üstüne çıkabilir.
 */
function rankByRadarScore(matches, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const scored = (Array.isArray(matches) ? matches : []).map((match) => ({
    match,
    radar: radarScore(match, { ...options, now })
  }));

  const phaseRank = (entry) => {
    const verdict = evaluateDisplayable(entry.match, now);
    if (!verdict.displayable) return 9;
    if (verdict.phase === "live") return 0;
    if (verdict.phase === "upcoming") return 2;
    return 1;
  };

  return scored.sort((left, right) => {
    if (!options.pureScore) {
      const byPhase = phaseRank(left) - phaseRank(right);
      if (byPhase !== 0) return byPhase;
    }
    const leftScore = left.radar.score === null ? -1 : left.radar.score;
    const rightScore = right.radar.score === null ? -1 : right.radar.score;
    if (leftScore !== rightScore) return rightScore - leftScore;

    // Eşit puanda daha çok ölçüye dayanan önce gelir.
    return right.radar.coverage - left.radar.coverage;
  });
}

module.exports = {
  COMPONENTS,
  SURPRISE_BONUS_MAX,
  SURPRISE_COMPONENT,
  CONFIDENCE_BANDS,
  FORM_SCALE,
  IMPORTANCE_SATURATION,
  STATUS_VALUE,
  radarScore,
  rankByRadarScore
};
