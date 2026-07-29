/**
 * YÖNETİM PANELİNİ BEYNİN VERİSİYLE DOLDUR.
 *
 * SORUN. `yonetim-paneli.html` bir operasyon aracı: "kaç maçın skoru eksik?",
 * "hangi kuralın testi yok?", "transfer hattı duruyor mu?" sorularına tek
 * ekranda cevap vermesi gerekiyor. Bu sorular istemci tarafında
 * cevaplanamıyor — sayım kaynak dosyaların kendisini okumayı gerektiriyor ve
 * tarayıcının depo diskine erişimi yok. Panel derleme zamanında doldurulmazsa
 * ya boş açılır ya da uydurma bir vitrin gösterir.
 *
 * ÇÖZÜM. Sayfa `services/brainService.js` çıktısıyla ön render edilir.
 * Panel hiçbir sayıyı KENDİ hesaplamaz: `brainState()` ne döndürdüyse onu
 * basar. İkinci bir toplama yapılsaydı aynı sayı panelde ve
 * `/api/analysis-brain` yanıtında farklı çıkabilir ve hangisinin doğru
 * olduğu görünmezdi.
 *
 * ÖLÇÜLMEYEN YERE SAYI YAZILMAZ. `brainState()` içindeki her ölçüm bloğu
 * `measured` bayrağı taşır. `measured: false` ise blokta sayı değil, neden
 * ölçülemediğini anlatan Türkçe bir `reason` vardır; panel o cümleyi basar.
 * `0` ile "bilinmiyor" aynı şey değildir ve sayfada da ayrı görünürler.
 *
 * ETİKET UYDURULMAZ. Dağılım satırlarındaki anahtarlar (`quick-ready`,
 * `bigFourMatch`, `confirmed`, `queued` …) makine anahtarlarıdır ve olduğu
 * gibi, `<code>` içinde yazılır. Yanına Türkçe bir ad YALNIZCA bir servis o
 * adı yetkili biçimde veriyorsa eklenir: rapor durumları
 * `matchReportStages.REPORT_STATUS`, gündem bantları
 * `agendaService.TIER_REASONS`, kaynak türleri
 * `transferService.sourceTypeLabel`. Panelin kendi sözlüğü yoktur; olsaydı
 * aynı anahtarın iki farklı Türkçe karşılığı dolaşıma girerdi.
 *
 * YALNIZCA KÖKE YAZILIR. `scripts/sync-public-assets.mjs` kökteki HTML
 * dosyalarının TAMAMINI `public/` içine kopyalıyor ve derleme zincirinde bu
 * betikten SONRA çalışıyor. İkinci bir yazma, iki kopyanın ayrışabileceği
 * yeni bir yol açmaktan başka bir işe yaramaz.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const {
  brainState,
  ruleDomains,
  rulesByDomain
} = require("../services/brainService.js");
const { describeConfig } = require("../services/supabase/config.js");
const { EXPECTED_TABLES } = require("../services/supabase/health.js");
const { TIER_REASONS } = require("../services/agendaService.js");
const { sourceTypeLabel } = require("../services/transferService.js");
const { formatFreshnessDate } = require("../services/freshnessService.js");

const PAGE = "yonetim-paneli.html";

/* ------------------------------------------------------------------ */
/* Biçimlendirme yardımcıları                                          */
/* ------------------------------------------------------------------ */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Makine anahtarı. Türkçeleştirilmez: kaynakta ne yazıyorsa o. */
function code(value) {
  return `<code>${escapeHtml(value)}</code>`;
}

/**
 * Tarih damgası. Görünen metni `freshnessService` yazar — sitenin geri
 * kalanıyla aynı biçim. Damga okunamıyorsa `<time>` hiç basılmaz; makineye
 * ayrıştıramadığı bir değeri geçerli gibi sunmak yanlış olurdu.
 */
function stamp(value) {
  const label = formatFreshnessDate(value);
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return escapeHtml(label);
  return `<time datetime="${escapeHtml(parsed.toISOString())}">${escapeHtml(label)}</time>`;
}

/**
 * Dosya boyutu. Yuvarlama tek yerde: 1 KB'ın altındaki dosya bayt olarak
 * yazılır, çünkü "0 KB" var olan bir dosyayı yok gibi gösterir.
 */
function formatBytes(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "Bilinmiyor";
  if (bytes < 1024) return `${bytes} bayt`;
  return `${Math.round(bytes / 1024)} KB`;
}

/* ------------------------------------------------------------------ */
/* Ortak parçalar                                                      */
/* ------------------------------------------------------------------ */

function statTile(value, label, note) {
  return `<div class="admin-stat"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span>${
    note ? `<em>${escapeHtml(note)}</em>` : ""
  }</div>`;
}

function statGrid(tiles) {
  return `<div class="admin-stat-grid">${tiles.join("")}</div>`;
}

/**
 * "Ölçemedik" kartı. Sayı yerine gerekçe taşır ve kaynağını adıyla söyler;
 * okuyucu boşluğun panelde mi yoksa veride mi olduğunu ancak böyle ayırır.
 */
function unmeasuredCard(title, block) {
  return `<article class="admin-unmeasured"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(block.reason)}</p><em>Kaynak: ${escapeHtml(block.source)}</em></article>`;
}

/**
 * Dağılım satırı: yetkili Türkçe ad (VARSA) + makine anahtarı + sayım.
 *
 * Ad boşsa satır yalnızca anahtarı gösterir. Boş bir etiket kabı basmak,
 * okuyucuya "burada bir ad olmalıydı ama kayboldu" dedirtir; oysa o anahtarın
 * hiçbir serviste yetkili bir Türkçe karşılığı yoktur.
 */
function distRow(key, count, options = {}) {
  let name = "";
  if (options.label && options.tone) {
    name = `<span class="report-status is-${escapeHtml(options.tone)}">${escapeHtml(options.label)}</span>`;
  } else if (options.label) {
    name = `<span class="admin-dist-name">${escapeHtml(options.label)}</span>`;
  }
  return `<li class="admin-dist-row"><span class="admin-dist-key">${name}${code(key)}</span><b>${escapeHtml(count)}</b></li>`;
}

function distList(rows, emptyNote) {
  if (!rows.length) return `<p class="admin-note">${escapeHtml(emptyNote)}</p>`;
  return `<ul class="admin-dist">${rows.join("")}</ul>`;
}

function panelHeading(text, note) {
  return `<h3 class="admin-heading">${escapeHtml(text)}</h3>${
    note ? `<p class="admin-note">${escapeHtml(note)}</p>` : ""
  }`;
}

/** Gerekçeli liste: hangi kayıt, neden. Sayı tek başına yeterli değil. */
function reasonList(entries) {
  return `<ul class="admin-reasons">${entries
    .map((entry) => `<li>${code(entry.id)}<span>${escapeHtml(entry.reason)}</span></li>`)
    .join("")}</ul>`;
}

/* ------------------------------------------------------------------ */
/* Bölümler                                                            */
/* ------------------------------------------------------------------ */

function generatedAtBlock(state) {
  return `<span class="admin-stamp-line">Ölçüm zamanı: ${stamp(state.generatedAt)}</span>` +
    `<span class="admin-stamp-line">Kural defteri sürümü: ${code(state.rules.version)}</span>` +
    `<span class="admin-stamp-line">Panel canlı bir gösterge değil, son derlemenin fotoğrafıdır.</span>`;
}

function rulesSummaryBlock(rules) {
  const tiles = [
    statTile(rules.total, "Kayıtlı kural", "rules/registry.json"),
    statTile(rules.domains.length, "Kural alanı"),
    statTile(rules.tested, "Testli kural"),
    statTile(rules.untested.length, "Testsiz kural"),
    statTile(rules.thresholds, "Kayıtlı eşik"),
    statTile(rules.vocabulary, "Kayıtlı Türkçe metin")
  ];

  // Testsiz kural gizlenmiyor: korumasız bir kural, ilk yeniden düzenlemede
  // sessizce kaybolabilecek bir karardır ve panelin işi bunu görünür kılmak.
  const untested = rules.untested.length
    ? `<div class="admin-note-card"><strong>Testi olmayan kurallar</strong><p>Bu kararlar bir testle korunmuyor; değiştirildiklerinde hiçbir yerde uyarı çıkmaz.</p><ul class="admin-idlist">${rules.untested
        .map((id) => `<li>${code(id)}</li>`)
        .join("")}</ul></div>`
    : `<p class="admin-note">Kayıtlı her kural bir testle korunuyor.</p>`;

  return `${statGrid(tiles)}${untested}`;
}

function registryAuditBlock(verification) {
  const flag = verification.ok
    ? `<span class="admin-flag is-ok">Denetlenebilen her kayıt geçti</span>`
    : `<span class="admin-flag is-warn">Defter kaynakla uyuşmuyor</span>`;

  const checked = statGrid([
    statTile(verification.checked.rules, "Denetlenen kural"),
    statTile(verification.checked.modules, "Bulunan modül dosyası"),
    statTile(verification.checked.entries, "Doğrulanan giriş adı"),
    statTile(verification.checked.tests, "Bulunan test dosyası")
  ]);

  const problems = verification.problems.length
    ? `<div class="admin-note-card is-warn"><strong>Bulunan tutarsızlıklar</strong><ul class="admin-idlist">${verification.problems
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join("")}</ul></div>`
    : "";

  // "ok" ile "tam denetlendi" aynı şey değil: yapılamayan denetim geçmiş
  // sayılmaz, adıyla yazılır.
  const skipped = verification.skipped.length
    ? `<div class="admin-note-card"><strong>Yapılamayan denetimler</strong><p>Bu satırlar denetlenemedi; güvence bu ölçüde eksiktir.</p><ul class="admin-idlist">${verification.skipped
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join("")}</ul></div>`
    : "";

  return `<p class="admin-flag-row">${flag}</p>${checked}${problems}${skipped}`;
}

function reportStagesBlock(reports) {
  if (!reports.measured) return unmeasuredCard("Rapor aşamaları ölçülemedi", reports);

  const tiles = statGrid([
    statTile(reports.total, "Maç kaydı", reports.source),
    statTile(reports.reportable, "Raporlanabilir maç"),
    statTile(reports.generated, "Üretilen rapor"),
    statTile(reports.withoutCore, "Çekirdeği eksik maç"),
    statTile(reports.unlabelled, "Tanınmayan durum")
  ]);

  const rows = Object.keys(reports.byStatus).map((key) => {
    const status = reports.byStatus[key];
    return distRow(key, status.count, { label: status.label, tone: status.tone });
  });

  const unlabelledNote = reports.unlabelled
    ? `<p class="admin-note">Tanınmayan durum sayacı sıfırdan büyük: bir rapor, defterde karşılığı olmayan bir durum anahtarı taşıyor.</p>`
    : "";

  return `${tiles}${panelHeading("Durum dağılımı", "Etiketler services/matchReportStages.js REPORT_STATUS metinleridir.")}${distList(
    rows,
    "Rapor durumu kaydı bulunamadı."
  )}${unlabelledNote}`;
}

function retryQueueBlock(retry) {
  const ledger = retry.ledger.measured
    ? statGrid([
        statTile(retry.ledger.tracked, "İzlenen maç", retry.ledger.source),
        statTile(
          retry.ledger.updatedAt ? formatFreshnessDate(retry.ledger.updatedAt) : "Bilinmiyor",
          "Deneme defterinin zamanı"
        )
      ])
    : unmeasuredCard("Deneme defteri ölçülemedi", retry.ledger);

  if (!retry.queue.measured) {
    return `${panelHeading("Deneme defteri")}${ledger}${panelHeading("Kuyruk")}${unmeasuredCard(
      "Kuyruk ölçülemedi",
      retry.queue
    )}`;
  }

  const counts = retry.queue.counts;
  const countRows = Object.keys(counts).map((key) => distRow(key, counts[key]));

  const actionRows = Object.keys(retry.queue.byAction).map((key) =>
    distRow(key, retry.queue.byAction[key])
  );

  const next = retry.queue.next.length
    ? `<div class="table-scroll"><table class="admin-table"><thead><tr><th>Maç</th><th>Eylem</th><th>Gerekçe</th><th>Deneme</th><th>Öncelik</th></tr></thead><tbody>${retry.queue.next
        .map(
          (entry) =>
            `<tr><td>${code(entry.id)}</td><td>${code(entry.action)}</td><td>${escapeHtml(
              entry.reason
            )}</td><td>${escapeHtml(entry.attempt)}</td><td>${escapeHtml(entry.priority)}</td></tr>`
        )
        .join("")}</tbody></table></div>`
    : `<p class="admin-note">Bu koşuda sağlayıcıya sorulacak maç yok.</p>`;

  // Kırpılan iş sessizce düşmez: sınıra takılan her kayıt gerekçesiyle görünür.
  const skipped = retry.queue.skipped.length
    ? `<div class="admin-note-card is-warn"><strong>Koşu sınırına takılanlar</strong>${reasonList(
        retry.queue.skipped.map((item) => ({ id: item.id, reason: `${item.action} · ${item.reason}` }))
      )}</div>`
    : `<p class="admin-note">Bu koşuda sınıra takılan kayıt yok.</p>`;

  return `${panelHeading("Deneme defteri")}${ledger}${panelHeading(
    "Kuyruk sayıları",
    "Anahtarlar services/reportRetrySchedule.js takviminin kendi adlarıdır; panel onlara kendi adını uydurmaz."
  )}${distList(countRows, "Kuyruk sayacı bulunamadı.")}${panelHeading(
    "Eyleme göre dağılım"
  )}${distList(actionRows, "Kuyrukta eylem kaydı yok.")}${panelHeading(
    "Sıradaki maçlar",
    "En fazla on kayıt listelenir."
  )}${next}${skipped}`;
}

function agendaBlock(agenda) {
  if (!agenda.measured) return unmeasuredCard("Gündem bantları ölçülemedi", agenda);

  const rows = Object.keys(agenda.byTier).map((tier) => {
    const band = agenda.byTier[tier];
    return distRow(tier, band.count, { label: TIER_REASONS[tier] || "" });
  });

  return `${statGrid([statTile(agenda.total, "Gündem kaydı", agenda.source)])}${panelHeading(
    "Bant dağılımı",
    "Boş bir bant arıza değildir ama görünmesi gerekir: kayıt gerçekten yok olabilir, hattı durmuş da olabilir."
  )}${distList(rows, "Gündem bandı kaydı bulunamadı.")}`;
}

function poolsBlock(pipeline) {
  const parts = [];

  parts.push(panelHeading("Transferler"));
  if (!pipeline.transfers.measured) {
    parts.push(unmeasuredCard("Transfer kayıtları ölçülemedi", pipeline.transfers));
  } else {
    parts.push(statGrid([statTile(pipeline.transfers.total, "Transfer kaydı", pipeline.transfers.source)]));
    parts.push(
      distList(
        Object.keys(pipeline.transfers.byStatus).map((key) =>
          distRow(key, pipeline.transfers.byStatus[key])
        ),
        "Transfer kaydı yok: ölçüldü, sonuç sıfır."
      )
    );
    parts.push(panelHeading("Kaynak türüne göre"));
    parts.push(
      distList(
        Object.keys(pipeline.transfers.bySourceType).map((key) =>
          distRow(key, pipeline.transfers.bySourceType[key], { label: sourceTypeLabel(key) || "" })
        ),
        "Kaynak türü kaydı yok: ölçüldü, sonuç sıfır."
      )
    );
  }

  parts.push(panelHeading("Maç sonu açıklamaları"));
  if (!pipeline.statements.measured) {
    parts.push(unmeasuredCard("Açıklama kayıtları ölçülemedi", pipeline.statements));
  } else {
    parts.push(statGrid([statTile(pipeline.statements.total, "Açıklama kaydı", pipeline.statements.source)]));
    parts.push(
      distList(
        Object.keys(pipeline.statements.byStatus).map((key) =>
          distRow(key, pipeline.statements.byStatus[key])
        ),
        "Açıklama kaydı yok: ölçüldü, sonuç sıfır."
      )
    );
  }

  parts.push(panelHeading("Maç analizleri"));
  if (!pipeline.analyses.measured) {
    parts.push(unmeasuredCard("Analiz kayıtları ölçülemedi", pipeline.analyses));
  } else {
    parts.push(
      statGrid([
        statTile(pipeline.analyses.total, "Analiz kaydı", pipeline.analyses.source),
        statTile(pipeline.analyses.ready, "Derin analiz düğmesi alan"),
        statTile(pipeline.analyses.notReady.length, "Eşiğe takılan")
      ])
    );
    // "3 kayıt hazır değil" demek boşluğu kapatmaya yetmez; hangi eşiğe
    // takıldığı görünmezse ne yapılacağı bilinemez.
    parts.push(
      pipeline.analyses.notReady.length
        ? `<div class="admin-note-card is-warn"><strong>Hazır olmayan analizler</strong>${reasonList(
            pipeline.analyses.notReady
          )}</div>`
        : `<p class="admin-note">Analiz kayıtlarının tamamı yayın eşiğini geçiyor.</p>`
    );
  }

  return parts.join("");
}

function dataFilesBlock(files) {
  const rows = files.map((file) => {
    if (!file.exists) {
      // Dosya yoksa boyut ve tarih uydurulmaz; "yok" bilgisi tek başına doğru.
      return `<tr><td>${code(file.path)}</td><td><span class="admin-flag is-warn">Dosya yok</span></td><td>Bilinmiyor</td><td>Bilinmiyor</td></tr>`;
    }
    return `<tr><td>${code(file.path)}</td><td><span class="admin-flag is-ok">Var</span></td><td>${escapeHtml(
      formatBytes(file.bytes)
    )}</td><td>${stamp(file.updatedAt)}</td></tr>`;
  });

  return `<div class="table-scroll"><table class="admin-table"><thead><tr><th>Kayıt dosyası</th><th>Durum</th><th>Boyut</th><th>Son değişme</th></tr></thead><tbody>${rows.join(
    ""
  )}</tbody></table></div>`;
}

/**
 * Kural tablosu. Kuralın CÜMLESİ burada basılmaz — defterdeki `statement` ve
 * `rationale` metinleri kaynak koda eşlik eden uzun gerekçelerdir ve yerleri
 * `docs/rules-catalogue.md`'dir. Panelin sorusu farklı: "bu kural nerede
 * yaşıyor ve onu ne koruyor?".
 */
function ruleTableBlock() {
  return ruleDomains()
    .map((domain) => {
      const rules = rulesByDomain(domain.id);
      const rows = rules
        .map(
          (rule) =>
            `<tr><td><b>${escapeHtml(rule.title)}</b>${code(rule.id)}</td><td>${code(
              rule.module
            )}</td><td>${code(rule.entry)}</td><td>${escapeHtml(rule.thresholds.length)}</td><td>${
              rule.test
                ? code(rule.test)
                : `<span class="admin-flag is-warn">Test yok</span>`
            }</td></tr>`
        )
        .join("");

      return `<section class="admin-domain"><h3 class="admin-heading">${escapeHtml(
        domain.title
      )} <span class="admin-count">${escapeHtml(rules.length)} kural</span></h3><p class="admin-note">${escapeHtml(
        domain.summary
      )}</p><div class="table-scroll"><table class="admin-table"><thead><tr><th>Kural</th><th>Yetkili dosya</th><th>Giriş</th><th>Eşik</th><th>Test</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    })
    .join("");
}

/* ------------------------------------------------------------------ */
/* Sayfaya yazma                                                       */
/* ------------------------------------------------------------------ */

/**
 * İşaretleyici bloğunu değiştirir — `scripts/prerender-core-pages.mjs` ile
 * AYNI desen. İki betiğin farklı işaretleyici sözleşmesi kullanması, bir
 * sonraki okuyucunun hangisinin geçerli olduğunu aramasına yol açardı.
 */
function replaceMarkerBlock(html, marker, content) {
  const start = `<!-- prerender:${marker}:start -->`;
  const end = `<!-- prerender:${marker}:end -->`;
  if (!html.includes(start) || !html.includes(end)) {
    console.warn(`Yönetim paneli: "${marker}" işaretleyicisi sayfada yok, blok atlandı`);
    return html;
  }

  const expression = new RegExp(
    `${start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
  );
  return html.replace(expression, `${start}\n${content}\n            ${end}`);
}

/**
 * Ölçülemeyen her blok günlüğe de düşer. Sayfada gerekçesiyle görünüyor ama
 * derlemeyi izleyen kişi sayfayı açmak zorunda kalmamalı: sessizce eksilen
 * bir ölçüm fark edilmez.
 */
function warnUnmeasured(state) {
  const blocks = [
    ["rapor aşamaları", state.pipeline.reports],
    ["deneme defteri", state.pipeline.retry.ledger],
    ["yeniden deneme kuyruğu", state.pipeline.retry.queue],
    ["gündem bantları", state.pipeline.agenda],
    ["transfer kayıtları", state.pipeline.transfers],
    ["açıklama kayıtları", state.pipeline.statements],
    ["analiz kayıtları", state.pipeline.analyses]
  ];

  let count = 0;
  for (const [name, block] of blocks) {
    if (block && block.measured === false) {
      count += 1;
      console.warn(`Yönetim paneli: ${name} ölçülemedi — ${block.reason}`);
    }
  }
  return count;
}

const source = path.join(root, PAGE);
if (!fs.existsSync(source)) {
  console.warn(`Yönetim paneli atlandı: ${PAGE} bulunamadı`);
  process.exit(0);
}

const state = brainState();
const unmeasuredCount = warnUnmeasured(state);

for (const problem of state.rules.verification.problems) {
  console.warn(`Yönetim paneli: kayıt defteri tutarsız — ${problem}`);
}


/**
 * SUPABASE BÖLÜMÜ.
 *
 * Derleme zamanında AĞA ÇIKMAZ: derleme, bir dış servisin o anki durumuna
 * bağlı olmamalı. Burada yalnızca YAPILANDIRMANIN VARLIĞI raporlanır.
 * Canlı bağlantı durumu `/api/supabase-health?probe=1` ucundan okunur.
 *
 * BU SAYFA HERKESE AÇIK. Yönetim panelini koruyan tek şey bir `noindex`
 * etiketi; robots.txt "Allow: /" diyor ve önünde kimlik doğrulaması yok.
 * Yani buraya basılan her şey yayımlanmış sayılır.
 *
 * Bu yüzden değişken ADI, anahtar UZUNLUĞU ve proje SUNUCU ADI artık
 * basılmıyor. Üçü de anahtar değerinin kendisi değil ama üçü de saldırgana
 * hedef veriyor: hangi projeye, hangi değişken adıyla, kaç karakterlik bir
 * anahtarla saldırılacağını söylüyor. Bunlar çalışma zamanı TANILAMASIDIR ve
 * yeri hız sınırı olan /api/supabase-health ucudur — statik bir sayfa değil.
 * Panelde yalnızca "Tanımlı / Eksik" bayrağı kalıyor; o da bir sır taşımıyor.
 */
function supabaseBlock() {
  const config = describeConfig();

  const flag = (ok, okText, warnText) =>
    `<span class="admin-flag is-${ok ? "ok" : "warn"}">${escapeHtml(ok ? okText : warnText)}</span>`;

  const rows = [
    ["Proje adresi", config.url.configured],
    ["Anon anahtar", config.anonKey.configured],
    ["Servis anahtarı", config.serviceKey.configured]
  ].map(([label, ok]) =>
    `<tr><td>${escapeHtml(label)}</td><td>${flag(ok, "Tanımlı", "Eksik")}</td></tr>`).join("");

  const warnings = [];
  if (!config.configured) {
    warnings.push(
      "Supabase yapılandırılmadı. Bu bir arıza değil: depo bulut olmadan da tam çalışır, " +
      "yerel JSON dosyaları tek doğruluk kaynağı olmaya devam eder."
    );
  }
  if (config.serviceKey.publiclyNamed) {
    warnings.push(
      "Servis anahtarı 'PUBLIC' ön ekli bir değişkende tanımlı görünüyor. Bu ön ek değeri " +
      "istemci paketine gömmek içindir; servis anahtarı RLS'i baypas ettiği için bu " +
      "yapılandırma veritabanını herkese açar."
    );
  }

  const warningHtml = warnings.length
    ? warnings.map((text) =>
      `<div class="admin-note-card is-warn"><strong>Dikkat</strong><p>${escapeHtml(text)}</p></div>`).join("")
    : `<div class="admin-note-card"><strong>Yapılandırma tamam</strong><p>${
      escapeHtml("Canlı bağlantı durumu için /api/supabase-health?probe=1 ucunu kullanın; " +
        "derleme dış servise bağlı olmasın diye burada ağa çıkılmıyor.")}</p></div>`;

  return [
    panelHeading("Kimlik bilgileri", "Yalnızca varlık gösterilir; değer, değişken adı ve uzunluk gösterilmez."),
    `<div class="table-scroll"><table class="admin-table"><thead><tr><th>Alan</th><th>Durum</th></tr></thead><tbody>${rows}</tbody></table></div>`,
    `<p class="admin-note">${escapeHtml(
      "Değişken adları, anahtar uzunlukları ve proje adresi bu sayfaya basılmaz: sayfa " +
      "herkese açıktır. Bu tanılamalar /api/supabase-health ucundan okunur.")}</p>`,
    warningHtml,
    panelHeading("Şema", "Göç dosyalarında tanımlı tablolar."),
    statGrid([
      statTile(EXPECTED_TABLES.length, "Beklenen tablo", "supabase/migrations"),
      statTile(config.configured ? "Hazır" : "Kapalı", "Bulut katmanı"),
      statTile("RLS", "Her tabloda zorunlu", "0005 göçü")
    ]),
    // Tablo adları KOD tanımlayıcısıdır, düz metin değil: <code> içinde
    // basılıyorlar. Aksi hâlde Türkçe metin denetimi onları çevrilmemiş
    // İngilizce sanır — ve haklı olur, çünkü düz metinde öyle görünürler.
    `<p class="admin-note">${escapeHtml("Tablolar:")} ${
      EXPECTED_TABLES.map((table) => code(table)).join(" ")
    }</p>`,
    `<p class="admin-note">${escapeHtml(
      "Satır sayıları ve satır düzeyi güvenlik durumu yalnızca canlı sorguyla okunur.")}</p>`
  ].join("");
}

const blocks = {
  "brain-generated-at": generatedAtBlock(state),
  "brain-rules-summary": rulesSummaryBlock(state.rules),
  "brain-registry-audit": registryAuditBlock(state.rules.verification),
  "brain-report-stages": reportStagesBlock(state.pipeline.reports),
  "brain-retry-queue": retryQueueBlock(state.pipeline.retry),
  "brain-agenda-tiers": agendaBlock(state.pipeline.agenda),
  "brain-data-pools": poolsBlock(state.pipeline),
  "brain-data-files": dataFilesBlock(state.data.files),
  "brain-rule-table": ruleTableBlock(),
  "brain-supabase": supabaseBlock()
};

let html = fs.readFileSync(source, "utf8");
for (const [marker, content] of Object.entries(blocks)) {
  html = replaceMarkerBlock(html, marker, content);
}
fs.writeFileSync(source, html, "utf8");

console.log(
  `Yönetim paneli dolduruldu: ${state.rules.total} kural / ${state.rules.domains.length} alan, ` +
    `defter denetimi ${state.rules.verification.ok ? "geçti" : "DÜŞTÜ"}, ` +
    `${unmeasuredCount} ölçüm bloğu ölçülemedi`
);
