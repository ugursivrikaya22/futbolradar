/**
 * KURAL BEYNİNİN TİP KATMANI.
 *
 * NEDEN VAR. Kuralların yetkili karar noktası her zaman `services/*.js`
 * dosyalarıdır; `rules/registry.json` bu kararların makine okunur dizinidir.
 * Ama defter ile onu okuyan TypeScript yüzeyleri arasında hiçbir sözleşme
 * yoktu: defterde bir alanın adı değişse ya da bir tip bozulsa, hata ancak
 * çalışma anında — üstelik yalnızca o alana dokunan yüzeyde — ortaya
 * çıkardı. Buradaki tipler o sözleşmeyi derleme zamanına taşıyor.
 *
 * BURASI KURAL UYGULAMAZ. Tek bir eşik, tek bir Türkçe metin, tek bir karar
 * bu dosyada YAŞAMAZ; hepsi servislerde ve templates/ altındadır. Burada
 * yalnızca "o kararların çıktısı hangi biçimde geliyor" yazılıdır. Aksi hâlde
 * aynı kural iki yerde tanımlanmış olur ve ikisi zamanla ayrışırdı.
 *
 * DARALTILMAYAN ALANLAR BİLEREK GENİŞ. `tone`, `action`, `tier` gibi alanlar
 * `string` olarak duruyor, birlik tipine (union) daraltılmıyor. Daraltmak,
 * templates/report-status.json ve reportRetrySchedule.js'teki kümeleri burada
 * İKİNCİ KEZ tanımlamak demekti; bir gün oraya yeni bir durum eklendiğinde
 * derleyici burayı hatırlatmaz, sessizce ayrışırlardı.
 *
 * NODE API'Sİ YOK. Bu katman saf TypeScript: fs, path, require, __dirname
 * kullanılmaz. Depoda `@types/node` bilerek kurulu değil (bkz.
 * lib/node-env.d.ts) ve bu dosyaların tarayıcıda da derlenebilmesi gerekiyor.
 */

/* ------------------------------------------------------------------ */
/* Kayıt defteri                                                       */
/* ------------------------------------------------------------------ */

/**
 * Bir eşiğin değeri. Dizi biçimi, "onaylı kaynaklar" gibi kümesel eşikler
 * için gerekli — rules/schema.json aynı dört biçime izin verir.
 */
export type RuleThresholdValue =
  | number
  | string
  | boolean
  | ReadonlyArray<number | string>;

/**
 * Kuralın kullandığı tek bir eşik.
 *
 * `unit` isteğe bağlı: birimsiz eşiklerde (bir küme, bir bayrak) uydurma bir
 * birim yazmak, panelde "5 yüzde" gibi anlamsız bir ölçü basardı.
 */
export type RuleThreshold = {
  readonly name: string;
  readonly value: RuleThresholdValue;
  readonly unit?: string;
};

/** Kural alanı. Her kural tam olarak bir alana bağlıdır. */
export type RuleDomain = {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
};

/**
 * Defterdeki tek bir kural kaydı.
 *
 * `module` + `entry` ikilisi kuralın GERÇEK adresidir: hangi dosyada, hangi
 * dışa aktarımda yaşıyor. `test` boş dize olabilir — bu "testi yok" demektir
 * ve gizlenmez; uydurma bir test yolu yazmak defteri yalancı yapardı.
 */
export type Rule = {
  readonly id: string;
  readonly domain: string;
  readonly title: string;
  readonly statement: string;
  readonly rationale: string;
  readonly module: string;
  readonly entry: string;
  readonly thresholds: readonly RuleThreshold[];
  readonly vocabulary: readonly string[];
  readonly test: string;
  readonly surfaces: readonly string[];
};

/** rules/registry.json dosyasının tamamı. */
export type RuleRegistry = {
  readonly $schema?: string;
  readonly version: string;
  readonly domains: readonly RuleDomain[];
  readonly rules: readonly Rule[];
};

/* ------------------------------------------------------------------ */
/* Ölçüm blokları                                                      */
/* ------------------------------------------------------------------ */

/**
 * Ölçülemeyen blok: sayı yerine Türkçe gerekçe taşır.
 *
 * Bir kaynak okunamadığında `total: 0` yazmak "ölçtük, sıfır çıktı" demektir;
 * doğru cevap ise "bilmiyoruz"dur. İkisi aynı şey olmadığı için tipte de ayrı
 * duruyorlar — `measured` alanı ayırt edici (discriminant) olduğundan
 * `if (blok.measured)` yazan her yüzey sayılara ancak gerçekten ölçülmüşse
 * erişebilir.
 */
export type Unmeasured = {
  readonly measured: false;
  readonly source: string;
  readonly reason: string;
};

/** Ölçülmüş blok: `source` neyin okunduğunu, alanlar sayıları taşır. */
export type Measured<TFields> = {
  readonly measured: true;
  readonly source: string;
} & TFields;

/** Ölçüldü ya da ölçülemedi — üçüncü bir ihtimal yok. */
export type Measurement<TFields> = Measured<TFields> | Unmeasured;

/* ------------------------------------------------------------------ */
/* Boru hattı sağlığı                                                  */
/* ------------------------------------------------------------------ */

/**
 * Rapor durumlarının dağılımı. Anahtar, templates/report-status.json'daki
 * `key` değeridir; etiket ve ton da oradan gelir, burada üretilmez.
 */
export type ReportStatusBreakdown = Readonly<
  Record<
    string,
    {
      readonly label: string;
      readonly tone: string;
      readonly count: number;
    }
  >
>;

/**
 * Rapor aşamaları sayımı.
 *
 * `unlabelled`, defterle kaynağın ayrıştığının işaretidir: tanınmayan bir
 * durum anahtarı sessizce kaybolmasın diye ayrı sayılır.
 */
export type ReportStageCounts = {
  readonly total: number;
  readonly reportable: number;
  readonly withoutCore: number;
  readonly generated: number;
  readonly unlabelled: number;
  readonly byStatus: ReportStatusBreakdown;
};

/** Deneme defteri özeti. Defter hiç oluşmamışsa blok `Unmeasured` olur. */
export type RetryLedgerCounts = {
  readonly tracked: number;
  readonly updatedAt: string | null;
};

/** Koşu sınırına takıldığı için bu turda sorulmayan kayıt. */
export type RetrySkippedEntry = {
  readonly id: string;
  readonly action: string;
  readonly reason: string;
};

/** Kuyruğun başındaki iş: sağlayıcıya bu koşuda sorulacak kayıt. */
export type RetryQueueEntry = {
  readonly id: string;
  readonly action: string;
  readonly reason: string;
  readonly attempt: number;
  readonly priority: number;
};

export type RetryQueueCounts = {
  readonly total: number;
  readonly queued: number;
  readonly skipped: number;
  readonly waiting: number;
  readonly done: number;
  readonly backfill: number;
};

/**
 * Kuyruğun anlık görüntüsü. `skipped` bilerek taşınıyor: kırpılan iş sessiz
 * düşmemeli, kaç kaydın hangi gerekçeyle sınıra takıldığı görünmeli.
 */
export type RetryQueueSnapshot = {
  readonly counts: RetryQueueCounts;
  readonly byAction: Readonly<Record<string, number>>;
  readonly skipped: readonly RetrySkippedEntry[];
  readonly next: readonly RetryQueueEntry[];
};

/** Deneme defteri ile kuyruk ayrı ölçülür: biri yoksa diğeri yine ölçülebilir. */
export type RetryHealth = {
  readonly ledger: Measurement<RetryLedgerCounts>;
  readonly queue: Measurement<RetryQueueSnapshot>;
};

/**
 * Gündem bantları. Bandın boş olması arıza değildir ama görünmelidir:
 * boş transfer bandı ya gerçekten transfer olmadığını ya da transfer
 * hattının durduğunu söyler.
 */
export type AgendaTierBreakdown = Readonly<
  Record<
    string,
    {
      readonly score: number;
      readonly count: number;
    }
  >
>;

export type AgendaCounts = {
  readonly total: number;
  readonly byTier: AgendaTierBreakdown;
};

export type TransferCounts = {
  readonly total: number;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly bySourceType: Readonly<Record<string, number>>;
};

export type StatementCounts = {
  readonly total: number;
  readonly byStatus: Readonly<Record<string, number>>;
};

/** Hazır olmayan analiz kaydı — gerekçesiyle, çünkü sayı tek başına boşluğu kapatmaz. */
export type AnalysisGap = {
  readonly id: string;
  readonly reason: string;
};

export type AnalysisCounts = {
  readonly total: number;
  readonly ready: number;
  readonly notReady: readonly AnalysisGap[];
};

/**
 * services/brainService.js → pipelineHealth() çıktısı.
 *
 * Her alt blok kendi başına ölçülür: maç kaydı okunamadığında rapor, kuyruk
 * ve gündem blokları `Unmeasured` olur ama transfer ve açıklama blokları
 * yine ölçülebilir. Tek bir "her şey ölçüldü" bayrağı olsaydı, okunabilen
 * kaynaklar da bilinmiyor sayılırdı.
 */
export type PipelineHealth = {
  readonly generatedAt: string;
  readonly reports: Measurement<ReportStageCounts>;
  readonly retry: RetryHealth;
  readonly agenda: Measurement<AgendaCounts>;
  readonly transfers: Measurement<TransferCounts>;
  readonly statements: Measurement<StatementCounts>;
  readonly analyses: Measurement<AnalysisCounts>;
};

/* ------------------------------------------------------------------ */
/* Defter özeti ve bütünleşik durum                                    */
/* ------------------------------------------------------------------ */

/**
 * Defterin kaynağa karşı denetimi.
 *
 * `skipped`, `problems`ten ayrı duruyor: sunucusuz derlemede scripts/ dizini
 * hiç bulunmaz ve orada "test dosyası yok" demek yanlış bir suçlama olurdu.
 * `ok`, "denetlenebilen her kayıt geçti" demektir.
 */
export type RegistryVerification = {
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly skipped: readonly string[];
  readonly checked: {
    readonly rules: number;
    readonly modules: number;
    readonly entries: number;
    readonly tests: number;
  };
};

/** Alan başlığı + o alandaki kural sayısı. */
export type RuleDomainSummary = RuleDomain & {
  readonly ruleCount: number;
};

/**
 * Defterin özeti. `untested` gizlenmiyor: korumasız bir kural, ilk yeniden
 * düzenlemede sessizce kaybolabilecek bir karardır.
 */
export type RegistrySummary = {
  readonly version: string;
  readonly total: number;
  readonly domains: readonly RuleDomainSummary[];
  readonly thresholds: number;
  readonly vocabulary: number;
  readonly tested: number;
  readonly untested: readonly string[];
  readonly verification: RegistryVerification;
};

/**
 * Kayıt dosyası envanteri. Dosya yoksa boyut ve tarih `null` — sıfır bayt
 * yazmak, var olmayan bir dosyayı boş bir dosya gibi gösterirdi.
 */
export type DataFileInventoryEntry = {
  readonly key: string;
  readonly path: string;
  readonly exists: boolean;
  readonly bytes: number | null;
  readonly updatedAt: string | null;
};

/**
 * services/brainService.js → brainState() çıktısı; api/analysis-brain.js'in
 * gövdesi ve yönetim panelinin ön render kaynağı da budur.
 *
 * Panel ile API aynı tipi okuyor: iki yüzeyin ayrı ayrı toplama yapması, aynı
 * sayının iki farklı yerde iki farklı değer göstermesi demek olurdu.
 */
export type BrainState = {
  readonly generatedAt: string;
  readonly rules: RegistrySummary;
  readonly pipeline: PipelineHealth;
  readonly data: {
    readonly files: readonly DataFileInventoryEntry[];
  };
};
