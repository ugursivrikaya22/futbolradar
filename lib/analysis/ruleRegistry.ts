/**
 * KURAL KAYIT DEFTERİNİN TİPLİ OKUYUCUSU.
 *
 * NEDEN AYRI BİR OKUYUCU. Defter bir JSON dosyası; `resolveJsonModule` ile
 * içe aktarıldığında TypeScript ona dosyanın o anki içeriğinden türettiği
 * GENİŞ ve tesadüfi bir tip verir. O tipe güvenmek, "bugünkü içerik" ile
 * "sözleşme"yi karıştırmak olur: bir kuralın `unit` alanı silindiğinde ya da
 * bir eşik dizi yerine dize olduğunda derleyici hiçbir şey söylemez, hata
 * çalışma anında panelde belirir.
 *
 * BU YÜZDEN JSON ÖNCE `unknown`. Belge, tipli erişimcilere ulaşmadan önce
 * GERÇEKTEN doğrulanıyor — boş bir `as RuleRegistry` cast'i yazılsaydı tip
 * hatası gizlenmiş, bozuk defter tipliymiş gibi dolaşmış olurdu. Doğrulama
 * yapmayan bir tip koruyucu, hiç koruyucu olmamaktan daha zararlıdır çünkü
 * güvenlik izlenimi verir.
 *
 * BOZUK DEFTER SESSİZ KALMAZ. Belge biçimi tutmuyorsa `getRegistry()` Türkçe
 * gerekçeleriyle hata fırlatır. Yarım bir defter döndürmek, olmayan kuralları
 * varmış, var olanları yokmuş gibi gösterirdi; eksik veriyi doğru veri gibi
 * sunmaktansa gürültüyle durmak doğrudur.
 *
 * NE DOĞRULANMAZ. Kural kimliklerinin benzersizliği, alan referanslarının
 * geçerliliği, `module`/`entry`/`test` yollarının diskte var olması burada
 * DENETLENMEZ. Onların tek yetkili denetçisi services/brainService.js
 * içindeki `verifyRegistry()`; aynı denetimi burada tekrarlamak ikinci bir
 * karar noktası yaratır ve iki taraf zamanla ayrışırdı. Zaten bu katman
 * dosya sistemine bakamaz: lib/ altında Node API'si kullanılmıyor.
 */

import registryDocument from "../../rules/registry.json";

import type {
  Rule,
  RuleDomain,
  RuleRegistry,
  RuleThreshold,
  RuleThresholdValue
} from "./types";

/**
 * Belge bilerek `unknown` olarak tutuluyor: JSON'dan türetilen tipe hiçbir
 * yerde güvenilmesin, tek geçiş yolu aşağıdaki doğrulama olsun.
 */
const RAW: unknown = registryDocument;

/* ------------------------------------------------------------------ */
/* İlkel doğrulayıcılar                                                */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Dizi koruyucusu. `Array.isArray` tek başına `unknown` değeri `any[]`
 * biçimine daraltır ve elemanlar sessizce `any` olur; bu sarmalayıcı
 * elemanları `unknown` bırakarak her birinin ayrıca doğrulanmasını zorunlu
 * kılar.
 */
function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** Boş ya da yalnızca boşluktan oluşan metin, "değer var" saymaz. */
function isFilledText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFilledTextArray(value: unknown): value is readonly string[] {
  return isArray(value) && value.every(isFilledText);
}

/** rules/schema.json'un eşik değeri için izin verdiği dört biçim. */
function isThresholdValue(value: unknown): value is RuleThresholdValue {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string" || typeof value === "boolean") return true;
  return (
    isArray(value) &&
    value.every(
      (item) =>
        typeof item === "string" || (typeof item === "number" && Number.isFinite(item))
    )
  );
}

/* ------------------------------------------------------------------ */
/* Kayıt doğrulayıcıları                                               */
/* ------------------------------------------------------------------ */

/**
 * Doğrulama, "geçti/kaldı" yerine gerekçe listesi üretiyor.
 *
 * Tek bir `false` değeri, defteri düzeltecek kişiye hangi kaydın hangi
 * alanının bozuk olduğunu söylemez; bozuk defterin en pahalı yanı da onu
 * bulmaktır. Bu yüzden her sorun kendi Türkçe cümlesiyle toplanıyor.
 */
function thresholdProblems(value: unknown, where: string): string[] {
  if (!isRecord(value)) return [`${where}: eşik kaydı bir nesne değil`];

  const problems: string[] = [];
  if (!isFilledText(value.name)) problems.push(`${where}: eşik "name" alanı boş ya da dize değil`);
  if (!isThresholdValue(value.value)) {
    problems.push(
      `${where}: eşik "value" alanı sayı, dize, mantıksal değer ya da bunların dizisi olmalı`
    );
  }
  // `unit` isteğe bağlı; ama yazıldıysa dolu olmalı — boş birim, panelde
  // sayının yanına anlamsız bir boşluk basmak demektir.
  if (value.unit !== undefined && !isFilledText(value.unit)) {
    problems.push(`${where}: eşik "unit" alanı yazıldıysa boş bırakılamaz`);
  }
  return problems;
}

function domainProblems(value: unknown, where: string): string[] {
  if (!isRecord(value)) return [`${where}: alan kaydı bir nesne değil`];

  const problems: string[] = [];
  for (const field of ["id", "title", "summary"] as const) {
    if (!isFilledText(value[field])) problems.push(`${where}: "${field}" alanı boş ya da dize değil`);
  }
  return problems;
}

function ruleProblems(value: unknown, where: string): string[] {
  if (!isRecord(value)) return [`${where}: kural kaydı bir nesne değil`];

  const problems: string[] = [];

  for (const field of [
    "id",
    "domain",
    "title",
    "statement",
    "rationale",
    "module",
    "entry"
  ] as const) {
    if (!isFilledText(value[field])) problems.push(`${where}: "${field}" alanı boş ya da dize değil`);
  }

  // Boş `test` bir hata DEĞİL, kabul edilmiş bir boşluktur: kuralın henüz
  // testi yok ve defter bunu gizlemek yerine yazıyor. Bu yüzden "dolu metin"
  // değil yalnızca "dize" aranıyor.
  if (typeof value.test !== "string") problems.push(`${where}: "test" alanı dize değil`);

  if (!isArray(value.thresholds)) {
    problems.push(`${where}: "thresholds" alanı dizi değil`);
  } else {
    value.thresholds.forEach((threshold, index) => {
      problems.push(...thresholdProblems(threshold, `${where} · thresholds[${index}]`));
    });
  }

  // Boş dizi "bu kural metin basmaz" demektir; dizinin kendisi zorunlu.
  if (!isFilledTextArray(value.vocabulary)) {
    problems.push(`${where}: "vocabulary" dolu metinlerden oluşan bir dizi olmalı`);
  }
  if (!isFilledTextArray(value.surfaces)) {
    problems.push(`${where}: "surfaces" dolu metinlerden oluşan bir dizi olmalı`);
  }

  return problems;
}

/**
 * Belgenin tamamını doğrular ve bulunan her sorunu Türkçe olarak döner.
 * Boş dizi "defter beklenen biçimde" demektir.
 */
export function registryProblems(value: unknown): readonly string[] {
  if (!isRecord(value)) return ["rules/registry.json bir nesne değil"];

  const problems: string[] = [];

  if (!isFilledText(value.version)) problems.push('"version" alanı boş ya da dize değil');

  if (!isArray(value.domains) || value.domains.length === 0) {
    problems.push('"domains" en az bir alan içeren bir dizi olmalı');
  } else {
    value.domains.forEach((domain, index) => {
      problems.push(...domainProblems(domain, `domains[${index}]`));
    });
  }

  if (!isArray(value.rules) || value.rules.length === 0) {
    problems.push('"rules" en az bir kural içeren bir dizi olmalı');
  } else {
    value.rules.forEach((rule, index) => {
      const label = isRecord(rule) && isFilledText(rule.id) ? rule.id : `rules[${index}]`;
      problems.push(...ruleProblems(rule, label));
    });
  }

  return problems;
}

/** Belge, defter sözleşmesine uyuyor mu? Koruyucu gerçekten doğrular. */
export function isRuleRegistry(value: unknown): value is RuleRegistry {
  return registryProblems(value).length === 0;
}

/* ------------------------------------------------------------------ */
/* Tipli erişimciler                                                   */
/* ------------------------------------------------------------------ */

/**
 * Doğrulama sonucu bir kez saklanıyor: defter derleme zamanı sabiti, her
 * çağrıda 49 kaydı yeniden gezmenin karşılığı yok.
 */
let verified: RuleRegistry | null = null;

/**
 * Defterin tamamı.
 *
 * Dönen nesne tiplerde `readonly`; bu yalnızca derleme zamanı bir korumadır.
 * Çalışma anındaki dondurma, belgeyi asıl sahiplenen yerde —
 * services/brainService.js `loadRegistry()` — yapılır. Aynı işi burada
 * tekrarlamak, defteri iki yerden sahiplenmek olurdu.
 *
 * @throws Belge beklenen biçimde değilse, bulunan tüm gerekçelerle.
 */
export function getRegistry(): RuleRegistry {
  if (verified !== null) return verified;

  if (!isRuleRegistry(RAW)) {
    const problems = registryProblems(RAW);
    throw new Error(
      `Kural kayıt defteri okunamadı — rules/registry.json beklenen biçimde değil:\n- ${problems.join("\n- ")}`
    );
  }

  verified = RAW;
  return RAW;
}

/** Kural alanları. */
export function getDomains(): readonly RuleDomain[] {
  return getRegistry().domains;
}

/** Tüm kurallar — alan ayrımı olmadan. */
export function getRules(): readonly Rule[] {
  return getRegistry().rules;
}

/**
 * Bir alanın kuralları. Tanınmayan alan için boş dizi döner, hata değil:
 * services/brainService.js `rulesByDomain()` de aynı davranışta; iki taraf
 * ayrışırsa panel ile API farklı cevap verirdi.
 */
export function rulesByDomain(domainId: string): readonly Rule[] {
  return getRules().filter((rule) => rule.domain === domainId);
}

/** Tek kural. Bulunamazsa `null` — uydurma bir kayıt üretilmez. */
export function findRule(ruleId: string): Rule | null {
  return getRules().find((rule) => rule.id === ruleId) ?? null;
}

/**
 * Testi olmayan kurallar.
 *
 * Bu liste bilerek kolay erişilebilir: korumasız bir kural, ilk yeniden
 * düzenlemede sessizce kaybolabilecek bir karardır ve sayısı görünmezse
 * boşluk kapanmaz.
 */
export function rulesWithoutTest(): readonly Rule[] {
  return getRules().filter((rule) => rule.test.trim().length === 0);
}

/**
 * Bir kuralın eşikleri.
 *
 * `null` ile `[]` bilerek ayrı: `null` "böyle bir kural yok", `[]` ise "kural
 * var ama sayısal eşiği yok" demektir. İkisini boş diziye indirgemek, yanlış
 * yazılmış bir kural kimliğini "eşiksiz kural" gibi gösterirdi.
 */
export function thresholdsOf(ruleId: string): readonly RuleThreshold[] | null {
  const rule = findRule(ruleId);
  return rule ? rule.thresholds : null;
}
