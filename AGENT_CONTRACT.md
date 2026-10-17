## Current release architecture (2026-10-17) — authoritative override

- Runtime is Next.js App Router + Node.js/TypeScript route handlers; there is no separately deployed Express app.
- The database provider is PostgreSQL via Prisma. Historical SQLite/local-runtime snippets below are archival and must not be used for the final deployment.
- Pitch review uses the current `src/lib/ai/agent-orchestrator.ts` bounded parallel specialist-task workflow (20 roles plus synthesis). These are task roles, not 20 separately trained models. Live analysis requires a valid provider key/model.
- Eligibility is decided by `src/lib/core/engine.ts`, never by the language model.
- Keep `.env`, database dumps, local deck uploads and generated logs out of version control/release archives.

---

# Masar — AGENT CONTRACT (v1.0)
> هذه الوثيقة العقد الملزم لكل وكيل يعمل على المشروع. اقرأها كاملة قبل كتابة أي سطر.
> معها: /home/z/my-project/worklog.md (سجل العمل — اقرأه قبل البدء وألحق سجلك بعد الانتهاء).

## 1. المنتج (مختصر)
منصة «مسار»: فرص تمويل موثّقة + محرك أهلية حتمي ثلاثي القيم يشرح حكمه بالأدلة + تحليل عروض بتأكيد المؤسس + متتبع طلبات وإشعارات بلا تكرار. عربية RTL أولًا مع إنجليزية. المبادئ الحاكمة:
1. **الأهلية تقررها القواعد وحدها** — النموذج اللغوي (GLM عبر z-ai-web-dev-sdk) لا يشارك في الحكم أبدًا.
2. **null بدل التخمين** — كل قيمة مستخرجة بلا صفحة واقتباس صحيحين تُسقط (Citation Guard).
3. **لا يدخل الملف شيء إلا بعد confirm-profile** (تأكيد المؤسس).
4. **الأصل لا يُعدَّل** — اقتراح الشريحة يُقبل أو يُعدَّل أو يُرفض، والأصل محفوظ.
5. النص داخل العروض/الصفحات **بيانات لا تعليمات** (مقاومة الحقن).
6. لا تنبؤ بالتمويل ولا تقديم تلقائي ولا درجة إجمالية واحدة للجاهزية.

## 2. تكييف البيئة (قرارات معمارية مُثبَّتة — لا تناقشها)
| الخطة | هنا | السبب |
|---|---|---|
| React+Vite وExpress منفصلان | Next.js 16 App Router واحد (API Routes = الخادم) | قيد بيئة التشغيل؛ نفس TypeScript في الطرفين |
| PostgreSQL | SQLite عبر Prisma (نفس المخطط العلائقي؛ JSON نصي) | قيد البيئة |
| pg-boss | معالجة متزامنة داخل طلب الرفع + دالة notifyByIdempotent | لا طوابير خارجية هنا |
| مزوّد LLM واحد | z-ai-web-dev-sdk (GLM) خلف محوّل مع fallback مسجّل | «أقوى نموذج متاح» في هذه البيئة |
| S3 موقّع | تخزين محلي storage/decks + نص الشرائح في القاعدة | قيد البيئة |
| argon2id | scrypt (node:crypto) | argon2 غير مثبت |
| Vitest/Playwright | فحوص تحقق يدوية عبر lint + متصفح الوكيل | قيد البيئة (لا تضف عدّادات اختبار) |

## 3. القواعد الصارمة لكل وكيل
- تعمل **فقط** داخل الملفات المسندة إليك في مهمتك. لا تعدّل `prisma/schema.prisma` ولا `src/app/page.tsx` ولا `src/app/layout.tsx` ولا ملفات وكلاء آخرين ولا `AGENT_CONTRACT.md` ولا `worklog.md` (الإلحاق فقط).
- **ممنوع** تشغيل `bun run dev` أو `bun run build` أو `next build`. يجوز `bun run lint`.
- الاستيراد بمسار `@/lib/...` و `@/components/...`.
- TypeScript صارم؛ لا `any` إلا مضطرًا مع تعليق.
- مكونات الواجهة عميلة (`'use client'`) وتستورد من `@/components/ui/*` (shadcn) و `@/lib/api-client`.
- نصوص الواجهة العربية موجودة داخل ملفك (قاموس ثنائي محلي إن احتجت إنجليزية) — لا ملف ترجمة مركزي.
- كل دالة/نوع من عقد الأسماء في §5 يجب أن يطابق التوقيع حرفيًّا.
- تعامل مع كلمات المرور عبر `src/lib/server/password.ts` (أنشئه في T9 فقط).
- بعد الانتهاء: ألحق سجلك بـ worklog.md (القالب في نهايته) وعدّل حالة مهمتك إن طُلب.
- إن وجدت تناقضًا في العقود: اتبع هذه الوثيقة واذكر الملاحظة في سجلك.

## 4. هيكل الملفات (ملكيات الوكلاء)
```
src/lib/core/types.ts          [منجز — عقد الأنواع، لا تعدّله]
src/lib/schemas/index.ts       [منجز — مخططات Zod، لا تعدّله]
src/lib/server/api.ts          [منجز — prisma + ok/fail/parseBody/requireUser/requireRole/assertSameOrigin/requireProfile/audit/parseJsonField]
src/lib/api-client.ts          [منجز — عميل الواجهة]
src/lib/core/engine.ts         [T3] المحرك الحتمي
src/lib/core/scoring.ts        [T4] الملاءمة + الموثوقية
src/lib/core/guards.ts         [T5] Citation/Suggestion Guards + PII + حقن
src/lib/core/text.ts           [T5] تطبيع النص العربي/الإنجليزي + تشابه
src/lib/ai/adapter.ts          [T6] المحوّل + AiRun
src/lib/ai/prompts.ts          [T6]
src/lib/ai/extract.ts          [T6] خط الاستخراج
src/lib/ai/suggest.ts          [T6] توليد الاقتراح (يمرّ بحارس T5)
src/lib/ai/draft.ts            [T6] مسودة فرصة من رابط (مع حارس SSRF)
src/lib/files/validate.ts      [T7] البصمة الثنائية/الحجم/الامتداد
src/lib/files/pdf.ts           [T7] pdfjs (ثبّت unpdf)
src/lib/files/pptx.ts          [T7] jszip (ثبّت jszip)
src/lib/pitch/criteria.ts      [T8] 9 معايير حتمية
src/lib/pitch/gap.ts           [T8] تقرير الفجوات
src/lib/pitch/claims.ts        [T8] ادعاءات + تعارض + فحوص مالية
src/lib/server/password.ts     [T9] scrypt hash/verify
src/lib/server/conditions.ts   [T10] تحويل شروط Prisma إلى RuleCondition
src/lib/server/notify.ts       [T14] إشعار بمفتاح فريد
src/lib/server/matches.ts      [T11] بناء المطابقات للملف الحالي
src/app/api/v1/**              [T9–T14] واجهات REST (خريطة §6)
src/components/app/*           [T15] الهيكل/التنقل/i18n/الثيم
src/components/views/*         [T16–T18] شاشات الوحدات
scripts/seed.ts                [T19] البذر
src/app/page.tsx               [المنسّق فقط — لا تلمسه]
```

## 5. عقد الأسماء (توقيعات إلزامية)
```ts
// core/engine.ts (T3)
export function evaluateCondition(profile: ProfileSnapshot, cond: RuleCondition, now?: Date): ConditionResult;
export function evaluateEligibility(profile: ProfileSnapshot, conditions: RuleCondition[], now?: Date): EligibilityResult;
export function quickProfileFromAnswers(a: QuickCheckAnswers): ProfileSnapshot; // يحوّل إجابات الفحص السريع
// أدوات القيم: toArabicLabel(key, value) للعرض العربي للقيم

// core/scoring.ts (T4)
export function computeFitScore(profile: ProfileSnapshot, opp: OpportunityForScoring, now?: Date): FitScoreResult | null; // null إن كان الحكم NOT_ELIGIBLE
export function computeReliability(input: ReliabilityInput, now?: Date): ReliabilityResult;
export interface OpportunityForScoring { sectors: string[]; stageMin?: string|null; stageMax?: string|null; amountMin?: number|null; amountMax?: number|null; fundingType?: string|null; geoPriority: boolean; languages: string[]; requiresDocs: string[]; deadline?: string|null; }

// core/guards.ts (T5)
export function normalizeText(s: string): string;
export function citationCheck(slides: Slide[], page: number, quote: string): CitationCheckResult;
export function suggestionGuard(originalSlideText: string, confirmedFacts: string[], suggestion: string): SuggestionGuardReport;
export function redactPii(text: string): { redacted: string; replacements: number };
export function detectPromptInjection(text: string): { suspicious: boolean; patterns: string[] };
// core/text.ts (T5)
export function trigramSimilarity(a: string, b: string): number; // 0..1
export function normalizeUrl(u: string): string; // يزيل معاملات التتبع والشرطة الخيرة ويوحّد النطاق

// ai/adapter.ts (T6)
export async function runLlm(req: LlmRequest, meta: { deckVersionId?: string; userId?: string }): Promise<LlmResponse>;
// ai/extract.ts (T6)
export async function extractDeckFields(slides: Slide[], profileHints: string[]): Promise<{ fields: ExtractedField[]; provider: string; model: string }>;
// ai/suggest.ts (T6)
export async function generateSuggestion(slide: Slide, evaluationNotesAr: string[], confirmedFacts: string[]): Promise<{ suggestedText: string; reasonAr: string; guard: SuggestionGuardReport; provider: string }>;
// ai/draft.ts (T6)
export async function draftOpportunityFromPage(pageText: string, url: string): Promise<{ draft: unknown; quotes: Array<{ url: string; quote: string }>; provider: string }>;
export function ssrfGuard(url: string): { allowed: boolean; reasonAr?: string };

// files/validate.ts (T7)
export function validateUpload(buf: Buffer, fileName: string): { ok: boolean; code?: string; messageAr: string; fileType?: "pdf"|"pptx"; size: number };
// files/pdf.ts (T7)
export async function extractPdfSlides(buf: Buffer): Promise<Slide[]>;
// files/pptx.ts (T7)
export async function extractPptxSlides(buf: Buffer): Promise<Slide[]>;

// pitch/criteria.ts (T8)
export const CRITERIA: Array<{ key: string; labelAr: string }>; // 9 معايير
export function evaluateReadiness(slides: Slide[], fields: ExtractedField[]): ReadinessReport;
// pitch/gap.ts (T8)
export function buildGapReport(profile: ProfileSnapshot, matches: Array<{ opp: any; result: EligibilityResult }>, readiness: ReadinessReport): GapReport;
// pitch/claims.ts (T8)
export function extractClaims(slides: Slide[]): ClaimItem[];
export function detectContradictions(claims: ClaimItem[]): Array<{ ar: string; pages: number[] }>;

// server/password.ts (T9)
export function hashPassword(pw: string): string; // scrypt + salt
export function verifyPassword(pw: string, stored: string): boolean;

// server/conditions.ts (T10)
export function loadRuleConditions(oppId: string): Promise<RuleCondition[]>;
// server/notify.ts (T14)
export async function notifyByIdempotent(p: { userId: string; opportunityId: string; eventType: string; versionNumber: number; payloadAr: string }): Promise<boolean>; // false إن كان مكررًا
// server/matches.ts (T11)
export async function buildMatchesForProfile(profileId: string): Promise<Array<{ opportunity: any; eligibility: EligibilityResult; fit: FitScoreResult|null; reliability: ReliabilityResult }>>;
```

## 6. خريطة API (كل المسارات تحت src/app/api/v1)
| المسار | الملف | الوكيل |
|---|---|---|
| POST /auth/register, /auth/login, /auth/logout, GET /auth/me | auth/[action]/route.ts أو auth/route.ts بأسلوب App Router | T9 |
| GET/PUT /profile | profile/route.ts | T14 |
| GET /opportunities, GET /opportunities/[id] | opportunities/… | T10 |
| GET /matches | matches/route.ts | T11 |
| POST /matches/what-if | matches/what-if/route.ts | T11 |
| POST /quick-check | quick-check/route.ts | T11 |
| POST /decks (multipart) | decks/route.ts | T12 |
| GET /decks | decks/route.ts | T12 |
| GET /decks/[id]/versions/[v] | decks/[id]/versions/[v]/route.ts | T12 |
| POST /decks/[id]/versions/[v]/confirm-profile | …/confirm-profile/route.ts | T12 |
| POST /decks/[id]/versions/[v]/retry | …/retry/route.ts | T12 |
| GET /decks/[id]/compare?from=&to= | decks/[id]/compare/route.ts | T12 |
| DELETE /decks/[id] | decks/[id]/route.ts | T12 |
| POST /decks/[id]/versions/[v]/slides/[n]/suggest | …/slides/[n]/suggest/route.ts | T13 |
| PATCH /decks/[id]/versions/[v]/slides/[n]/suggestion | …/slides/[n]/suggestion/route.ts | T13 |
| GET/POST /applications, PATCH /applications/[id] | applications/… | T14 |
| GET/PUT /documents, PUT /documents/[type] | documents/… | T14 |
| GET /notifications, PATCH /notifications/[id] | notifications/… | T14 |
| POST /admin/opportunities | admin/opportunities/route.ts | T10 |
| POST /admin/opportunities/draft-from-url | admin/opportunities/draft-from-url/route.ts | T10 |
| POST /admin/opportunities/[id]/submit-review, publish, reject | admin/opportunities/[id]/[action]/route.ts | T10 |
| POST /admin/opportunities/[id]/update (نسخة + تصنيف + إشعار) | admin/opportunities/[id]/update/route.ts | T10 |
| GET /admin/duplicates | admin/duplicates/route.ts | T10 |
| GET /health | health/route.ts | T10 |

ملاحظات API: كل الاستجابات بمغلف `{ok, data} | {ok:false, error:{code,message,details}}` عبر ok()/fail() من server/api.ts. كل طلبات التغيير POST/PATCH/PUT/DELETE تستدعي assertSameOrigin أولًا ثم requireUser/requireRole. الفرص تُعرض للمؤسس فقط إن status=PUBLISHED (وأرشيف لا يظهر). المسؤول يرى الكل. **لا يعتمد كاتب المسودة عمله** (تحقق في الخادم: approvedById ≠ createdById) وPUBLISHED يتطلب رابطًا وverifiedAt ومعتمِدًا. تقييد IDOR: كل استعلام مقيّد بمالك المورد (profileId من requireProfile).

## 7. منطق المحرك (T3 — ملزِم)
- الشرط الإلزامي ثبت عدم استيفائه **بدليل ok** → الحكم NOT_ELIGIBLE (الرفض المؤكد أولوية حتى مع شروط غير محسومة).
- كل الشروط الإلزامية مستوفاة بأدلة كافية → ELIGIBLE.
- غير ذلك → UNCERTAIN مع سبب لكل حالة (نقص ملف / غموض نص / بلا دليل / دليل قديم >180 يومًا).
- الشرط الإلزامي بلا دليل → يُقيَّد الحكم عند UNCERTAIN (لا ELIGIBLE).
- الشرط الغامض (ambiguous) → UNRESOLVED بسبب «غموض في نص الجهة» والإجراء: مراسلة الجهة.
- القيمة null/غائبة → UNRESOLVED (MISSING_PROFILE_DATA) — لا تُعامل false.
- لمؤسسين متعددين: scope=any يكفي مؤسسًا واحدًا يستوفي، وscope=all يلزم جميعهم. حقل founder.region يُقرأ من founders أولًا ثم من fields (fallback).
- تُعاد عوائق التنفيذ (paymentMethods/hasBankAccount…) في executionNotes فقط.

## 8. درجات (T4 — ملزِم)
- **الملاءمة 100** (تُحسب لـ ELIGIBLE/UNCERTAIN فقط): قطاع 25 (تقاطع/اتحاد)، مرحلة 20 (قرب وسط المدى)، نوع/مبلغ التمويل 20، أولوية جغرافية 10، فجوة مستندات 10 (نسبة المتوفر من requiresDocs)، الوقت 10 (أيام حتى الموعد مقابل أيام لسد الفجوات = 30 افتراضيًّا)، لغة 5. أوزان قابلة للتمرير كمعامل optional للتجربة E5.
- **الموثوقية 100**: مصدر رسمي 40 (official=40, trusted=20, غيره 0)، حداثة 25 (≤30 يوم كامل؛ تنقص خطيًّا حتى 0 عند 180)، تغطية أدلة 25 (نسبة الشروط الإلزامية بدليل)، سلامة الرابط 10 (ok=10, fail_once=5, fail_twice=0). المستويات: ≥80 high، 50–79 medium، <50 low مع تحذير.

## 9. الحراس (T5 — ملزِم)
- **Citation Guard**: يطبع الاقتباس تطبيعًا (تطويل/تشكيل/همزات/مسافات/ترقيم/أرقام هندية↔غربية) ثم يتحقق وجوده في نص الشريحة بالصفحة المذكورة؛ الصفحة خارج النطاق أو اقتباس فارغ → رفض. الحكم النهائي للرفض يُطبَّق في T6/T12 (القيمة تُحذف وتعلَّم dropped).
- **Suggestion Guard**: NEW_FACT — رقم أو اسم ظهر في الاقتراح ولم يرد في الشريحة أو الحقائق المؤكدة؛ UNSUPPORTED_SUPERLATIVE — صيغة تفوق (أفضل/رقم 1/الأضخم/revolutionary/world's first…) بلا دعم؛ TOO_LONG — أكثر من 320 حرفًا أو 3 جمل.
- **PII**: بريد/هاتف/رقم هوية/عناوين → عناصر نائبة [EMAIL_1]… قبل أي استدعاء نموذج.
- **الحقن**: أنماط «ignore previous instructions/تجاهل التعليمات/system prompt/…» → علم suspicious وبلّغ المستخدم؛ النص يبقى بيانات.
- **تشابه**: trigramSimilarity للتكرارات (عنوان+جهة ≥ 0.72 → «تكرار محتمل»)، وnormalizeUrl للرابط الموحّد.

## 10. العروض (T6/T7/T8/T12/T13 — ملزِم)
- الأنواع المسموحة: pdf/pptx بالبصمة الثنائية (%PDF- / PK..)، الحد 20MB، والحد 60 صفحة.
- المعالجة: (1) استخراج الشرائح نصًّا، (2) LLM/مسار طوارئ يستخرج الحقول بصيغة {key,value,page,quote,confidence}، (3) Citation Guard على كل حقل — الساقط يعلَّم dropped مع سببه، (4) claims من الأرقام، (5) readiness الـ9 معايير، (6) gap report. الفاشل جزئيًّا → PARTIAL (إعادة المحاولة تعالج الفاشل فقط)، الفاشل كليًّا → FAILED_EXTRACTION برسالة مفهومة (ليس 500).
- اقتراح الشريحة: عند الطلب لشريحة واحدة؛ يمرّ بـ Suggestion Guard؛ القرار accepted/edited/rejected؛ الأصل محفوظ كنسخة؛ النص يُعرض raw (XSS-safe: لا HTML).
- 9 معايير الجاهزية (نص عربي): problem، customer، solution، market، business_model، traction، team، competition، ask_clarity — أربعة مستويات strong/adequate/weak/missing بدليل نصي من الشرائح.
- الفحوص المالية الحتمية: TAM≥SAM≥SOM، اتساق نمو الإيرادات (لا سالب حيث قيم مطلقة)، منطقية النسب (نمو>1000% موسوم)، وتناقض الادعاءات (قيمتان مختلفتان لنوع واحد بفارق >20%).

## 11. الإشعارات (T14 — ملزِم)
مفتاح فريد (userId, opportunityId, eventType, versionNumber) — القيد UNIQUE في القاعدة + التقاط P2002 وإرجاع false. «إعادة تشغيل المهمة لا تكرر الإشعار». التغيير الجوهري: الموعد/الشروط الإلزامية/المبلغ/المستندات/فتح أو إغلاق الفرصة → إشعار لمن حفظ الفرصة (INTERESTED/PREPARING) أو بدأ طلبًا، مع إعادة تقييم الأهلية في الحمولة.

## 12. الواجهة (T15–T18 — ملزِم)
- عربية RTL افتراضيًا + تبديل EN/LTR كامل؛ `<html dir>` يتبع اللغة (يديره T15 عبر السياق).
- الألوان: خلفية فاتحة/داكنة (next-themes)؛ **ممنوع البنفسجي indigo والأزرق الافتراضي** كأساس — استعمل لوحة «زيتون فيريدِيان + رملي» (أخضر داكن teal-green + أوفر كريمي + برتقالي طيني للتحذير). الشرائح والخطوط كما في globals.css الحالي مع إضافة عائلة عربية عبر next/font (Noto Sans Arabic أو IBM Plex Sans Arabic).
- Sticky footer: `min-h-screen flex flex-col` وfooter `mt-auto`. Responsive mobile-first. شاشة واحدة (SPA) بتبويبات داخل page.tsx — التنقل عبر سياق التطبيق (T15) لا عبر routes.
- كل نص أزرار/حالات تحميل/toast (sonner متوفر)؛ أخطاء واضحة قابلة للفعل.
- الحكم يُعرض بثلاث شرائح لونية (أخضر/أحمر/كهرماني) مع الأدلة والاقتباس وعبارة الجهة و«آخر تحقق» وروابط المصدر.

## 13. البذر (T19)
- مستخدمون: founder@masar.demo (مؤسس)، reviewer@masar.demo (مراجع)، كلمة المرور: Masar#2026 (تجريبي — الإنتاج من متغيرات بيئة).
- 52 فرصة PUBLISHED منوّعة (≈40% محلية، 30% إقليمية، 30% دولية) بشروط وأدلة وverifiedAt حديثة، **منها 10 فخاخ عمدًا**: (أ) MENA دون ذكر فلسطين، (ب) اشتراط تسجيل شركة خارجي، (ج) تسمية غامضة للقدس/الشتات (ambiguous)، (د) استثناء غير ظاهر في المصدر، (هـ) شرط إلزامي بلا دليل.
- أسماء الجهات والبرامج **تخيّلية بديلة** (Demo-grade: لا بيانات حقيقية) بأدلة صالحة داخليًّا — موثّق في README.
- ملف شركة «الزراعة الذكية» (سيناريو الخطة): مؤسِّسة في الضفة الغربية + مؤسس في الشتات، 12 حقلًا بمصادر يدوية.
- عرض عربي جاهز (DeckVersion READY) بنصوص 12 شريحة مع استخراج مسبق (provider=mock-replay) — مسار «الإعادة المسجّلة» لخطة الطوارئ.

## 14. قالب سجل worklog.md (إلزامي عند الإلحاق)
```markdown
---
Task ID: <ID>
Agent: <اسم النموذج/الوكيل>
Task: <المهمة>

Work Log:
- <خطوات>

Stage Summary:
- <الملفات المُنتجة والقرارات>
```

## 15. عقد الواجهة النهائي (إلزامي لكل وكلاء الواجهة T15–T18)

**ملكية globals.css:** T15 وحده. **layout.tsx وpage.tsx:** المنسّق وحده (لا تلمسهما).

**الأنواع المشتركة (يعرّفها T15 في src/components/app/types.ts):**
```ts
export type ViewKey = "home" | "opportunities" | "matches" | "profile" | "deck" | "tracker" | "documents" | "notifications" | "whatif" | "quickcheck" | "readiness" | "admin";
export interface ViewProps {
  onNavigate: (view: ViewKey, params?: Record<string, unknown>) => void;
  params?: Record<string, unknown>;
}
```

**i18n (يعرّفه T15 في src/components/app/i18n.tsx):** `I18nProvider` + `useI18n(): { lang: "ar"|"en", dir: "rtl"|"ltr", setLang, t: (ar: string, en: string) => string }` — الدالة t تُمرَّر النصين معًا (قاموس موضعي داخل كل مكوّن — لا ملف مركزي). تغيير اللغة يبدّل document.documentElement.dir/lang.

**جلب البيانات في الشاشات:** useEffect + api من `@/lib/api-client` مع حالات تحميل (Skeleton) وأخطاء واضحة (sonner toast). لا TanStack Query.

**جلسة المستخدم:** كل شاشة تحتاج مستخدمًا تجلب /auth/me نفسها عند أول render (المنسّق يمنع الوصول في page.tsx، والشاشة تعرض بياناتها). شاشة الفحص السريع quickcheck عامة بلا جلسة.

**ملفات الشاشات (default export):**
- T16: `src/components/views/HomeView.tsx` (نظرة عامة + دعوات)، `OpportunitiesView.tsx` (تصفح + تفاصيل فرصة Drawer/Dialog بالأدلة والاقتباسات وsourceWording و«آخر تحقق» + الموثوقية بإشاراتها + نسخ التغيير)، `MatchesView.tsx` (الأحكام الثلاثة بشرائح لونية أخضر/أحمر/كهرماني + تفسير كل شرط + عوامل الملاءمة + زر «تتبع هذه الفرصة» → tracker).
- T17: `src/components/views/ProfileView.tsx` (تحرير الحقول مع مصدر كل حقل وصفحة/اقتباس للحقول من العرض + المؤسسون)، `WhatIfView.tsx` (تعديل حقول مؤقتة → الفرص التي انقلب حكمها قبل/بعد)، `QuickCheckView.tsx` (استبيان 8–10 أسئلة للزائر → أحكام مبدئية).
- T18: `src/components/views/DeckView.tsx` (رفع ملف PDF/PPTX + قائمة النسخ + نتيجة: استخراج بتأكيد/رفض لكل حقل + الفجوات + الادعاءات والتعارض + مقارنة نسختين)، `SlideCorrectionView.tsx` (لكل شريحة: الأصل + ملاحظات التقييم + مقترح عند الطلب + أزرار قبول/تعديل/رفض — النص خام raw)، `TrackerView.tsx` (الطلبات + الإشعارات)، `DocumentsView.tsx` (مستندات الشركة بحالاتها)، `ReadinessView.tsx` (لوحة الجاهزية: معايير التسعة + الفجوات + المستندات + الأحكام في صفحة)، `AdminView.tsx` (لوحة المراجع: قائمة انتظار + إنشاء L0 + مسودة من رابط + نشر/رفض + تحديث فرصة (نسخة) + التكرارات).

**قواعد العرض الإلزامية:** الحكم ELIGIBLE أخضر (emerald)، NOT_ELIGIBLE أحمر (rose)، UNCERTAIN كهرماني (amber). الموثوقية: ≥80 أخضر، 50–79 كهرماني، <50 أحمر مع تحذير ظاهر. كل رقم مالي بعملة صريحة. التواريخ بصيغة عربية واضحة (Intl.DateTimeFormat("ar")). شاشة واحدة بتبويب علوي، والموبايل drawer/قائمة منسدلة. اقتراح الشريحة والمخرجات النصية للنموذج تُعرض نصًّا خامًّا (لا HTML إطلاقًا).
