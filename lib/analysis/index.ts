/**
 * KURAL BEYNİNİN TypeScript GİRİŞİ.
 *
 * NEDEN TEK GİRİŞ. Tüketiciler (components/, ileride eklenecek TS yüzeyleri)
 * doğrudan `./types` ya da `./ruleRegistry` yollarına bağlanırsa, katmanın
 * içindeki her dosya adı bir dış sözleşmeye dönüşür ve iç düzenlemeyi
 * imkânsız kılar. Buradan geçen isimler sözleşmedir; dosya yerleşimi değil.
 *
 * Tipler `export type` ile yeniden dışa aktarılıyor: `isolatedModules`
 * benzeri kipler altında tipin değer sanılıp derlenen çıktıya sızmaması için.
 */

export type {
  AgendaCounts,
  AgendaTierBreakdown,
  AnalysisCounts,
  AnalysisGap,
  BrainState,
  DataFileInventoryEntry,
  Measured,
  Measurement,
  PipelineHealth,
  RegistrySummary,
  RegistryVerification,
  ReportStageCounts,
  ReportStatusBreakdown,
  RetryHealth,
  RetryLedgerCounts,
  RetryQueueCounts,
  RetryQueueEntry,
  RetryQueueSnapshot,
  RetrySkippedEntry,
  Rule,
  RuleDomain,
  RuleDomainSummary,
  RuleRegistry,
  RuleThreshold,
  RuleThresholdValue,
  StatementCounts,
  TransferCounts,
  Unmeasured
} from "./types";

export {
  findRule,
  getDomains,
  getRegistry,
  getRules,
  isRuleRegistry,
  registryProblems,
  rulesByDomain,
  rulesWithoutTest,
  thresholdsOf
} from "./ruleRegistry";
