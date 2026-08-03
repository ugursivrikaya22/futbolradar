/**
 * SEARCH DEMAND ENGINE TESTLERİ
 *
 * İki sert kural sınanıyor:
 *   1. Kanıtsız talep puana dönüşemez (uydurma hacim yok).
 *   2. Kesinleşmemiş transfer, planlama katmanında bile kesinleşmiş gibi
 *      başlıklanamaz.
 * Ayrıca gerçek veri dosyaları (opportunities / content-plan / calendar)
 * şema ve kural doğrulamasından geçiyor: panel ve üretim hattı bozuk ya da
 * kanıtsız kayıtla beslenemez.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const {
  WEIGHTS,
  HIGH_PRIORITY_THRESHOLD,
  computeOpportunityScore,
  isHighPriority,
  validateEvidence,
  validateOpportunity,
  validateContentPlanEntry
} = require("../services/searchDemand.js");

// ── 1. Ağırlıklar ürün kararıyla eşleşiyor ve 100'e tamamlanıyor ───────────
{
  const total = Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  assert.equal(total, 100, "ağırlıklar toplamı 100 olmalı");
  assert.equal(WEIGHTS.demand, 25, "güncel arama talebi %25 olmalı");
  assert.equal(WEIGHTS.trendRise, 20, "trend yükselişi %20 olmalı");
  assert.equal(WEIGHTS.turkeyRelevance, 15, "Türkiye ilgisi %15 olmalı");
  assert.equal(HIGH_PRIORITY_THRESHOLD, 75, "yüksek öncelik eşiği 75 olmalı");
}

const evidence = (source = "internal-fixtures", ref = "data/fixture-calendar.json", note = "sinyal") =>
  ({ source, ref, note });

// ── 2. Kanıtsız boyut sıfırlanır — uydurma hacim puana dönüşmez ────────────
{
  const withEvidence = computeOpportunityScore({
    demand: { value: 80, evidence: [evidence()] }
  });
  assert.equal(withEvidence.breakdown.demand.value, 80, "kanıtlı boyut değerini korumalı");
  assert.equal(withEvidence.missingData.length, 0, "kanıtlı boyutta eksik veri raporlanmamalı");

  const withoutEvidence = computeOpportunityScore({ demand: { value: 80, evidence: [] } });
  assert.equal(withoutEvidence.breakdown.demand.value, 0, "kanıtsız boyut sıfırlanmalı");
  assert.ok(withoutEvidence.missingData.includes("demand"), "eksik veri açıkça raporlanmalı");

  const bogusEvidence = computeOpportunityScore({
    demand: { value: 80, evidence: [{ source: "hisler", ref: "", note: "" }] }
  });
  assert.equal(bogusEvidence.breakdown.demand.value, 0, "geçersiz kanıt, kanıt sayılmamalı");
}

// ── 3. Puan aritmetiği ve eşik ─────────────────────────────────────────────
{
  const full = computeOpportunityScore({
    demand: { value: 100, evidence: [evidence()] },
    trendRise: { value: 100, evidence: [evidence()] },
    turkeyRelevance: { value: 100, evidence: [evidence()] },
    siteFit: { value: 100, evidence: [evidence()] },
    beatableCompetition: { value: 100, evidence: [evidence()] },
    timeSensitivity: { value: 100, evidence: [evidence()] },
    internalLinks: { value: 100, evidence: [evidence()] },
    longTerm: { value: 100, evidence: [evidence()] }
  });
  assert.equal(full.score, 100, "tüm boyutlar 100 ise puan 100 olmalı");
  assert.ok(isHighPriority(full.score), "100 puan yüksek öncelik olmalı");
  assert.ok(!isHighPriority(74), "74 yüksek öncelik sayılmamalı");
  assert.ok(isHighPriority(75), "75 yüksek öncelik sınırında kabul edilmeli");

  const overflow = computeOpportunityScore({ demand: { value: 250, evidence: [evidence()] } });
  assert.equal(overflow.breakdown.demand.value, 100, "boyut değeri 100 ile sınırlanmalı");
}

// ── 4. Kanıt doğrulama: izlenebilirlik zorunlu ─────────────────────────────
{
  assert.equal(validateEvidence(evidence()).valid, true, "geçerli kanıt kabul edilmeli");
  assert.equal(validateEvidence({ source: "search-console", ref: "", note: "x" }).valid, false, "referanssız kanıt geçersiz");
  assert.equal(
    validateEvidence({ source: "manual-research", ref: "notlarım", note: "x" }).valid,
    false,
    "manual-research URL taşımalı"
  );
}

// ── 5. Fırsat doğrulama: karar, kanıt ve iç bağlantı zorunlu ───────────────
{
  const base = {
    id: "ornek",
    query: "örnek sorgu",
    suggestedTitle: "Örnek başlık",
    contentType: "qa",
    classifications: ["informational"],
    decision: "new",
    evidence: [evidence()],
    linkTargets: ["a.html", "b.html", "c.html"]
  };
  assert.equal(validateOpportunity(base).valid, true, "geçerli fırsat kabul edilmeli");
  assert.equal(validateOpportunity({ ...base, evidence: [] }).valid, false, "kanıtsız fırsat reddedilmeli");
  assert.equal(validateOpportunity({ ...base, decision: "belki" }).valid, false, "kararsız fırsat reddedilmeli");
  assert.equal(
    validateOpportunity({ ...base, decision: "update" }).valid,
    false,
    "update kararı mevcut sayfayı göstermeli"
  );
  assert.equal(
    validateOpportunity({ ...base, linkTargets: ["a.html"] }).valid,
    false,
    "üçten az iç bağlantı hedefi reddedilmeli"
  );

  const rumourTitled = validateOpportunity({
    ...base,
    classifications: ["transfer-intent"],
    suggestedTitle: "Oyuncu resmen imzaladı"
  });
  assert.equal(rumourTitled.valid, false, "kesinleşmemiş transfer başlığı kesinlik ifadesi taşıyamaz");

  const confirmedTitled = validateOpportunity({
    ...base,
    classifications: ["transfer-intent"],
    transferStatus: "confirmed",
    suggestedTitle: "Kulüp transferi resmen açıkladı"
  });
  assert.equal(confirmedTitled.valid, true, "doğrulanmış transferde kesinlik ifadesi serbest");
}

// ── 6. İçerik planı: ince sayfa ve kaynaksız iddia koruması ────────────────
{
  const plan = {
    slug: "ornek-sayfa",
    type: "qa",
    title: "Örnek | FutbolRadar",
    description: "Örnek açıklama.",
    h1: "Örnek",
    updatedAt: "2026-08-03T10:00:00+03:00",
    directAnswer: "Doğrudan cevap ilk ekranda.",
    sections: [
      { heading: "Bölüm 1", paragraphs: ["a".repeat(320)] },
      { heading: "Bölüm 2", paragraphs: ["b".repeat(320)] }
    ],
    internalLinks: [
      { href: "a.html", label: "A" },
      { href: "b.html", label: "B" },
      { href: "c.html", label: "C" }
    ],
    sources: [{ name: "Kaynak", url: "https://example.com" }]
  };
  assert.equal(validateContentPlanEntry(plan).valid, true, "geçerli plan kabul edilmeli");
  assert.equal(validateContentPlanEntry({ ...plan, slug: "örnek sayfa" }).valid, false, "Türkçe karakterli slug reddedilmeli");
  assert.equal(
    validateContentPlanEntry({ ...plan, sections: [{ heading: "Tek", paragraphs: ["kısa"] }] }).valid,
    false,
    "ince içerik reddedilmeli"
  );
  assert.equal(validateContentPlanEntry({ ...plan, sources: [] }).valid, false, "kaynaksız plan reddedilmeli");
  assert.equal(validateContentPlanEntry({ ...plan, internalLinks: [] }).valid, false, "iç bağlantısız plan reddedilmeli");
  assert.equal(validateContentPlanEntry({ ...plan, directAnswer: "" }).valid, false, "doğrudan cevapsız plan reddedilmeli");

  const hub = {
    ...plan,
    slug: "ornek-transfer",
    type: "transfer-hub",
    overallStatus: "rumour",
    claims: [{ confidence: "rumour", statement: "Görüşmelerin sürdüğü öne sürülüyor", sourceName: "X", sourceUrl: "https://example.com" }]
  };
  assert.equal(validateContentPlanEntry(hub).valid, true, "geçerli transfer merkezi kabul edilmeli");
  assert.equal(
    validateContentPlanEntry({
      ...hub,
      claims: [{ confidence: "rumour", statement: "Oyuncu resmen imzaladı" }]
    }).valid,
    false,
    "söylenti kaydı kesinlik ifadesi taşıyamaz"
  );
  assert.equal(
    validateContentPlanEntry({ ...hub, overallStatus: "confirmed" }).valid,
    false,
    "doğrulanmış kayıt olmadan overallStatus confirmed olamaz"
  );
}

// ── 7. Gerçek veri dosyaları kurallardan geçiyor ───────────────────────────
{
  const opportunitiesPath = path.join(root, "data", "search-demand", "opportunities.json");
  assert.ok(fs.existsSync(opportunitiesPath), "data/search-demand/opportunities.json bulunmalı");
  const payload = JSON.parse(fs.readFileSync(opportunitiesPath, "utf8"));
  const items = Array.isArray(payload.items) ? payload.items : [];
  assert.ok(items.length >= 50, `en az 50 fırsat kaydı olmalı (şu an ${items.length})`);

  const ids = new Set();
  for (const entry of items) {
    const verdict = validateOpportunity(entry);
    assert.equal(verdict.valid, true, `fırsat "${entry && entry.id}" geçersiz: ${verdict.errors.join("; ")}`);
    assert.ok(!ids.has(entry.id), `yinelenen fırsat id: ${entry.id}`);
    ids.add(entry.id);

    // Puan, kayıttaki boyutlardan yeniden hesaplanabilir olmalı (uydurma
    // toplam puan yazılamaz).
    const recomputed = computeOpportunityScore(entry.dimensions || {});
    assert.equal(
      entry.score,
      recomputed.score,
      `fırsat "${entry.id}" puanı boyutlardan türetilmeli (kayıt ${entry.score}, hesap ${recomputed.score})`
    );
  }

  const planPath = path.join(root, "data", "search-demand", "content-plan.json");
  assert.ok(fs.existsSync(planPath), "data/search-demand/content-plan.json bulunmalı");
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  const pages = Array.isArray(plan.pages) ? plan.pages : [];
  assert.ok(pages.length >= 10, `içerik planında en az 10 sayfa olmalı (şu an ${pages.length})`);

  const slugs = new Set();
  for (const page of pages) {
    const verdict = validateContentPlanEntry(page);
    assert.equal(verdict.valid, true, `plan "${page && page.slug}" geçersiz: ${verdict.errors.join("; ")}`);
    assert.ok(!slugs.has(page.slug), `yinelenen slug: ${page.slug}`);
    slugs.add(page.slug);
  }

  // Plan, fırsat listesindeki bir kayda bağlanmalı: plansız üretim yok.
  for (const page of pages) {
    if (page.type === "dashboard") continue;
    assert.ok(
      items.some((entry) => entry.plannedSlug === page.slug),
      `plan "${page.slug}" fırsat listesinde karşılık bulmalı`
    );
  }

  const calendarPath = path.join(root, "data", "search-demand", "calendar.json");
  assert.ok(fs.existsSync(calendarPath), "data/search-demand/calendar.json bulunmalı");
  const calendar = JSON.parse(fs.readFileSync(calendarPath, "utf8"));
  assert.ok(Array.isArray(calendar.days) && calendar.days.length >= 30, "takvim en az 30 gün içermeli");
  for (const day of calendar.days) {
    assert.ok(text(day.date), "takvim günü tarih taşımalı");
    assert.ok(Array.isArray(day.actions) && day.actions.length, `takvim günü ${day.date} en az bir eylem taşımalı`);
  }
}

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

console.log("Search demand engine testleri geçti (ağırlıklar, kanıt zorunluluğu, eşik, transfer dili, ince sayfa koruması, gerçek veri dosyaları).");
