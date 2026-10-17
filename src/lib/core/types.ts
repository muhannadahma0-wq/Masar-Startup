/**
 * Masar — أنواع النواة الحتمية (packages/core في الخطة)
 * لا اعتماد على قاعدة بيانات ولا شبكة. كل شيء هنا نقاء TypeScript قابل للاختبار.
 * ملاحظة التكييف: حزمة packages/core في الخطة أصبحت src/lib/core لأن البيئة تطبيق واحد.
 */

// ————— الأحكام والنتائج —————

export type Judgment = "ELIGIBLE" | "NOT_ELIGIBLE" | "UNCERTAIN";

export type ReliabilityLevel = "high" | "medium" | "low";

export type ConditionStatus = "SATISFIED" | "NOT_SATISFIED" | "UNRESOLVED";

export type EvidenceState = "ok" | "missing" | "stale" | "weak";

export type UnresolvedReason =
  | "MISSING_PROFILE_DATA"   // نقص في الملف
  | "AMBIGUOUS_WORDING"      // غموض في نص الجهة
  | "NO_EVIDENCE"            // الشرط الإلزامي بلا دليل
  | "STALE_EVIDENCE"         // دليل قديم (> 180 يومًا)
  | "WEAK_EVIDENCE";         // دليل بلا رابط أو اقتباس

// ————— الحقول المعروفة للملف والشروط —————

export const PROFILE_FIELD_KEYS = [
  "company.name",
  "company.sectors",        // string[] (قيم SECTOR_KEYS)
  "company.stage",          // idea | prototype | early_revenue | scaling
  "company.registrationCountry", // مفتاح دولة ISO-3 صغير أو "none" (غير مسجلة)
  "company.legalStatus",    // not_registered | registered_local | registered_foreign
  "company.ageMonths",      // number
  "company.teamSize",       // number
  "company.womenLed",       // boolean
  "company.monthlyRevenueUSD", // number
  "company.tractionUsers",  // number
  "company.askAmountUSD",   // number — المبلغ المطلوب
  "company.askType",        // equity | non_equity | any
  "company.languages",      // string[] من LANGUAGE_KEYS (لغات الفريق)
  "company.requiredDocs",   // string[] مفاتيح مستندات متوفرة
  "founder.region",         // west_bank | gaza | east_jerusalem | inside_48 | diaspora
  "founder.nationality",    // مفتاح دولة اختياري
  "founder.hasBankAccount", // boolean
  "founder.paymentMethods", // string[] bank_transfer | paypal | wise | other
] as const;

export type ProfileFieldKey = (typeof PROFILE_FIELD_KEYS)[number];

export const SECTOR_KEYS = [
  "agritech", "fintech", "healthtech", "edtech", "cleantech", "iot",
  "ecommerce", "logistics", "tourism", "food", "manufacturing", "software",
  "ai", "water", "energy", "social", "media", "other",
] as const;

export const STAGE_KEYS = ["idea", "prototype", "early_revenue", "scaling"] as const;

export const DOC_TYPE_KEYS = [
  "registration_cert", "pitch_deck", "financial_statements", "founder_id",
  "business_plan", "tax_record", "bank_letter", "prototype_demo", "letters_of_support",
] as const;

export const REGION_VALUES = ["west_bank", "gaza", "east_jerusalem", "inside_48", "diaspora"] as const;

export const COUNTRY_KEYS = [
  "ps", "jo", "eg", "ae", "sa", "qa", "kw", "tr", "us", "gb", "de", "fr", "sg", "other",
] as const;

export const LEGAL_STATUS_VALUES = ["not_registered", "registered_local", "registered_foreign"] as const;

export const CONDITION_OPS = [
  "eq", "neq", "in", "not_in", "gte", "lte", "between", "contains", "exists",
] as const;

export type ConditionOp = (typeof CONDITION_OPS)[number];

// ————— بنى المدخلات للمحرك —————

export interface RuleCondition {
  id: string;
  field: ProfileFieldKey;
  op: ConditionOp;
  value: unknown;          // JSON: string | number | boolean | string[] | [number, number]
  mandatory: boolean;
  ambiguous: boolean;      // صياغة الجهة غامضة → UNCERTAIN بسبب غموض النص
  scope: "any" | "all";    // لمؤسسين متعددين: يكفي أحدهم أم جميعهم
  sourceWording?: string | null; // عبارة الجهة كما وردت
  evidence?: RuleEvidence | null;
}

export interface RuleEvidence {
  url: string;
  quote: string;
  verifiedAt: string; // ISO date
}

export interface ProfileFieldValue {
  field: ProfileFieldKey;
  value: unknown;         // null تعني «غير مذكور» — لا تخمين
  source: "manual" | "deck";
  deckId?: string;
  deckVersion?: number;
  page?: number;
  quote?: string;
  confirmedAt?: string;
}

export interface ProfileSnapshot {
  fields: ProfileFieldValue[];
  founders: Array<{
    name?: string | null;
    region?: string | null;
    nationality?: string | null;
    isPrimary: boolean;
  }>;
  documents: Array<{ docType: string; status: "available" | "missing" | "expired" }>;
}

// ————— نتيجة التقييم —————

export interface ConditionResult {
  conditionId: string;
  field: ProfileFieldKey;
  op: ConditionOp;
  mandatory: boolean;
  status: ConditionStatus;
  evidenceState: EvidenceState;
  sourceWording?: string | null;
  expected: string;   // وصف متوقع بالعربية للواجهة
  actual: string;     // الوصف الفعلي أو «غير مذكور»
  unresolvedReason?: UnresolvedReason;
  suggestedAction?: string; // ما يمكن فعله
  evidence?: RuleEvidence | null;
}

export interface EligibilityResult {
  judgment: Judgment;
  summary: string;          // جملة تفسير عربية
  summaryEn?: string;       // English equivalent of the deterministic verdict summary
  conditions: ConditionResult[];
  satisfiedCount: number;
  notSatisfiedCount: number;
  unresolvedCount: number;
  blockingReasons: string[];    // أسباب NOT_ELIGIBLE
  blockingReasonsEn?: string[]; // English reasons, same deterministic criteria
  uncertainReasons: string[];   // أسباب UNCERTAIN
  uncertainReasonsEn?: string[]; // English reasons, same deterministic criteria
  executionNotes: string[];     // عوائق تنفيذ (لا تغيّر الحكم)
  executionNotesEn?: string[];  // English notes, never affect the verdict
}

// ————— درجة الملاءمة (100) —————

export interface FitFactorResult {
  key: "sector" | "stage" | "funding" | "geoPriority" | "documents" | "time" | "language";
  labelAr: string;
  labelEn?: string;
  weight: number;
  score: number;      // 0..weight
  detail: string;     // تفسير عربي
  detailEn?: string;
}

export interface FitScoreResult {
  total: number; // 0..100
  factors: FitFactorResult[];
}

// ————— مؤشر موثوقية الفرصة (100) —————

export interface ReliabilityInput {
  sourceType: "official" | "trusted_aggregator" | "other";
  verifiedAt?: string | null;
  mandatoryConditionCount: number;
  mandatoryWithEvidenceCount: number;
  linkCheckState: "ok" | "fail_once" | "fail_twice";
}

export interface ReliabilityResult {
  total: number; // 0..100
  level: ReliabilityLevel;
  signals: Array<{ key: string; labelAr: string; labelEn?: string; weight: number; score: number; detail: string; detailEn?: string }>;
  warningAr?: string;
  warningEn?: string;
}

// ————— الحراس —————

export interface GuardFlag {
  rule: "NEW_FACT" | "UNSUPPORTED_SUPERLATIVE" | "TOO_LONG" | "QUOTE_NOT_FOUND" | "PAGE_OUT_OF_RANGE" | "EMPTY_QUOTE" | "SUSPICIOUS_PATTERN";
  detailAr: string;
  matched?: string;
}

export interface CitationCheckResult {
  passed: boolean;
  flags: GuardFlag[];
  normalizedQuote: string;
}

export interface SuggestionGuardReport {
  passed: boolean;
  flags: GuardFlag[];
}

// ————— العرض —————

export interface Slide {
  index: number;      // 1-based
  title: string;
  text: string;
}

export type ExtractionStatus = "confirmed" | "rejected" | "pending" | "dropped";

export interface ExtractedField {
  key: ProfileFieldKey | (string & {});
  value: unknown;     // null = غير مذكور
  page: number;
  quote: string;
  confidence: number; // 0..1
  status: ExtractionStatus;
  droppedReason?: string;
}

export type ReadinessLevel = "strong" | "adequate" | "weak" | "missing";

export interface CriterionResult {
  key: string;          // معيار ثابت لا يعتمد على اللغة
  labelAr: string;
  labelEn?: string;
  level: ReadinessLevel;
  evidenceAr: string;   // الدليل/الشرح؛ قد يتضمن اقتباسًا أصليًا لا يُترجم
  evidenceEn?: string;  // شرح ثنائي اللغة، مع إبقاء الاقتباس الأصلي كما هو
  slides: number[];     // صفحات ذات صلة
}

export interface ReadinessReport {
  criteria: CriterionResult[];
  generatedAt: string;
  overallSummaryAr: string;
  overallSummaryEn?: string;
}

export interface ClaimItem {
  id: string;
  type: "revenue" | "growth" | "market_size" | "users" | "funding_ask" | "other";
  value: number;
  unit?: string;
  page: number;
  quote: string;
  status: "kept" | "dropped";
}

export interface GapReport {
  missingProfileFields: ProfileFieldKey[];
  missingCriteria: string[];
  perOpportunity: Array<{
    opportunityId: string;
    title: string;
    judgment: Judgment;
    gapsAr: string[];
    gapsEn?: string[];
    missingDocs: string[];
  }>;
  notesAr: string[];
  notesEn?: string[];
}

// ————— الإشعارات والتغييرات —————

export type ChangeType = "substantive" | "non_substantive";

export interface OpportunityChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

// ————— النموذج اللغوي (المحوّل) —————

export interface LlmRequest {
  purpose: "EXTRACTION" | "SUGGESTION" | "DRAFT_FROM_URL" | "PITCH_AGENT";
  systemPrompt: string;
  userPayload: string;
  maxTokens?: number;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  timeoutMs?: number;
}

export interface LlmResponse {
  text: string;
  provider: string;      // "openai" | "glm" | "mock-replay"
  model: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  usedFallback: boolean;
  errorCode?: string;
}
