"use client";
/**
 * Masar — T16: OpportunitiesView — تصفّح الفرص + تفاصيل الفرصة بأدلتها
 * =============================================================================
 * - شريط بحث (debounce) + فلاتر: النوع/الجغرافيا/القطاع + الترتيب
 *   (الموعد الأقرب | الأحدث) — GET /opportunities?q=&type=&geography=&sector=&sort=&skip=&take
 *   (المعامل الفعلي للبحث في المسار هو q — مطابق لكود T10).
 * - شبكة بطاقات فرص (العنوان، الجهة، المبلغ بالعملة، الموعد، ReliabilityMeter مصغر،
 *   شارات الجغرافيا/النوع/القطاع) + تحميل تدريجي بزر «المزيد».
 * - النقر يفتح Dialog التفاصيل (GET /opportunities/[id]): الوصف، المبلغ والعملة،
 *   الموعد بالتاريخ العربي، كل شرط ببطاقة (المتوقع مشتقًّا من field/op/value،
 *   إلزامي/غير إلزامي، شارة «غامض»، عبارة الجهة الأصلية sourceWording في اقتباس،
 *   الدليل: رابط clickable + اقتباس + «آخر تحقق»، الأدلة الناقصة معلَّمة)،
 *   الموثوقية بإشاراتها الأربع، آخر النسخ، وزر «تتبّع هذه الفرصة»
 *   (POST /applications ثم toast نجاح + الزر يتحوّل «قيد التتبع»).
 * - إثراء اختياري: أحكام شروطك من GET /matches (إن توفرت) تُدمج ببطاقة الشرط
 *   لتُظهر «قيمة ملفك» وحالة الشرط — الفشل صامت (اختياري، قد يختلف الدور).
 * القواعد: useI18n().t لكل نص، Skeleton، أخطاء toast sonner، RTL بخصائص منطقية، لمس ≥44px.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bell,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Globe2,
  History,
  Layers,
  Loader2,
  Quote,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ReliabilityMeter } from "@/components/app/badges";
import { formatDate, formatMoney, useI18n } from "@/components/app/i18n";
import type { ViewProps } from "@/components/app/types";
import { api } from "@/lib/api-client";

// ————— أشكال الردود (مطابقة لمسارات T10/T11/T14 الفعلية) —————

interface ReliabilityLike {
  total: number;
  level: "high" | "medium" | "low";
  warningAr?: string;
  warningEn?: string;
}

interface ReliabilityFull extends ReliabilityLike {
  signals: Array<{ key: string; labelAr: string; labelEn?: string; weight: number; score: number; detail: string; detailEn?: string }>;
}

interface OpportunityListItem {
  id: string;
  title: string;
  orgName: string;
  type: string;
  amountMin: number | null;
  amountMax: number | null;
  currency: string;
  sectors: string[];
  geography: string;
  deadline: string | null;
  deadlineTz: string;
  reliability: ReliabilityFull;
  status: string;
}

interface OpportunityListResponse {
  items: OpportunityListItem[];
  total: number;
  skip: number;
  take: number;
  sort: string;
}

interface ConditionRuleView {
  id: string;
  field: string;
  op: string;
  value: unknown;
  mandatory: boolean;
  ambiguous: boolean;
  scope: "any" | "all";
  sourceWording?: string | null;
  evidence?: { url: string; quote: string; verifiedAt: string } | null;
}

interface OpportunityDetail {
  id: string;
  title: string;
  orgName: string;
  description: string;
  status: string;
  type: string;
  fundingType: string | null;
  amountMin: number | null;
  amountMax: number | null;
  currency: string;
  sectors: string[];
  stageMin: string | null;
  stageMax: string | null;
  geography: string;
  geoPriority: boolean;
  languages: string[];
  requiresDocs: string[];
  applicationUrl: string | null;
  sourceType: string;
  linkCheckState: string;
  deadline: string | null;
  deadlineTz: string;
  verifiedAt: string | null;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  conditions: ConditionRuleView[];
  reliability: ReliabilityFull;
  versions: Array<{
    versionNumber: number;
    changeType: string;
    changeCategory: string | null;
    reason: string | null;
    createdAt: string;
  }>;
}

/** شرط مطابق من GET /matches (إثراء اختياري — T11) */
interface MatchConditionLite {
  field: string;
  op: string;
  mandatory: boolean;
  status: "SATISFIED" | "NOT_SATISFIED" | "UNRESOLVED";
  evidenceState: "ok" | "missing" | "stale" | "weak";
  expected: string;
  actual: string;
  unresolvedReason?: string;
  sourceWording?: string | null;
  evidence?: { url: string; quote: string; verifiedAt: string } | null;
}

interface MatchLite {
  opportunity: { id: string };
  conditions: MatchConditionLite[];
}

interface ApplicationsResponse {
  applications: Array<{ opportunity: { id: string } | null }>;
}

// ————— قواميس ثنائية اللغة (محلية — قاموس موضعي وفق العقد §15) —————

type BiLabel = { ar: string; en: string };

const OPP_TYPE_LABELS: Record<string, BiLabel> = {
  grant: { ar: "منحة", en: "Grant" },
  accelerator: { ar: "مسرّع أعمال", en: "Accelerator" },
  incubator: { ar: "حاضنة أعمال", en: "Incubator" },
  competition: { ar: "مسابقة", en: "Competition" },
  fellowship: { ar: "زمالة", en: "Fellowship" },
  loan: { ar: "قرض", en: "Loan" },
};

const GEOGRAPHY_LABELS: Record<string, BiLabel> = {
  local: { ar: "محلية", en: "Local" },
  regional: { ar: "إقليمية", en: "Regional" },
  international: { ar: "دولية", en: "International" },
};

const SECTOR_LABELS: Record<string, BiLabel> = {
  agritech: { ar: "تقنية زراعية", en: "Agritech" },
  fintech: { ar: "تقنية مالية", en: "Fintech" },
  healthtech: { ar: "تقنية صحية", en: "Healthtech" },
  edtech: { ar: "تقنية تعليمية", en: "Edtech" },
  cleantech: { ar: "تقنية نظيفة", en: "Cleantech" },
  iot: { ar: "إنترنت الأشياء", en: "IoT" },
  ecommerce: { ar: "تجارة إلكترونية", en: "E-commerce" },
  logistics: { ar: "خدمات لوجستية", en: "Logistics" },
  tourism: { ar: "سياحة", en: "Tourism" },
  food: { ar: "أغذية", en: "Food" },
  manufacturing: { ar: "تصنيع", en: "Manufacturing" },
  software: { ar: "برمجيات", en: "Software" },
  ai: { ar: "ذكاء اصطناعي", en: "AI" },
  water: { ar: "مياه", en: "Water" },
  energy: { ar: "طاقة", en: "Energy" },
  social: { ar: "مشاريع اجتماعية", en: "Social" },
  media: { ar: "إعلام", en: "Media" },
  other: { ar: "أخرى", en: "Other" },
};

const FIELD_LABELS: Record<string, BiLabel> = {
  "company.name": { ar: "اسم الشركة", en: "Company name" },
  "company.sectors": { ar: "قطاعات الشركة", en: "Company sectors" },
  "company.stage": { ar: "مرحلة الشركة", en: "Company stage" },
  "company.registrationCountry": { ar: "بلد التسجيل", en: "Registration country" },
  "company.legalStatus": { ar: "الوضع القانوني", en: "Legal status" },
  "company.ageMonths": { ar: "عمر الشركة (بالأشهر)", en: "Company age (months)" },
  "company.teamSize": { ar: "حجم الفريق", en: "Team size" },
  "company.womenLed": { ar: "قيادة نسائية", en: "Women-led" },
  "company.monthlyRevenueUSD": { ar: "الإيراد الشهري (دولار)", en: "Monthly revenue (USD)" },
  "company.tractionUsers": { ar: "عدد المستخدمين", en: "Traction (users)" },
  "company.askAmountUSD": { ar: "المبلغ المطلوب (دولار)", en: "Funding ask (USD)" },
  "company.askType": { ar: "نوع التمويل المطلوب", en: "Funding type sought" },
  "company.languages": { ar: "لغات الفريق", en: "Team languages" },
  "company.requiredDocs": { ar: "المستندات المتوفرة", en: "Available documents" },
  "founder.region": { ar: "موقع المؤسس", en: "Founder region" },
  "founder.nationality": { ar: "جنسية المؤسس", en: "Founder nationality" },
  "founder.hasBankAccount": { ar: "حساب بنكي للمؤسس", en: "Founder bank account" },
  "founder.paymentMethods": { ar: "وسائل استلام التمويل", en: "Payment methods" },
};

const OP_PHRASES: Record<string, BiLabel> = {
  eq: { ar: "يساوي", en: "equals" },
  neq: { ar: "لا يساوي", en: "does not equal" },
  in: { ar: "ضمن", en: "one of" },
  not_in: { ar: "ليس ضمن", en: "not one of" },
  gte: { ar: "على الأقل", en: "at least" },
  lte: { ar: "على الأكثر", en: "at most" },
  between: { ar: "بين", en: "between" },
  contains: { ar: "يتضمّن", en: "includes" },
  exists: { ar: "قيمة مذكورة مطلوبة", en: "a value is required" },
};

/** تسمية القيم المعروفة عبر كل الحقول (مفاتيح القيم لا تت collide عمليًّا) */
const VALUE_LABELS: Record<string, BiLabel> = {
  west_bank: { ar: "الضفة الغربية", en: "West Bank" },
  gaza: { ar: "غزة", en: "Gaza" },
  east_jerusalem: { ar: "القدس الشرقية", en: "East Jerusalem" },
  inside_48: { ar: "الداخل الفلسطيني", en: "Inside 1948 territories" },
  diaspora: { ar: "الشتات", en: "Diaspora" },
  idea: { ar: "فكرة", en: "Idea" },
  prototype: { ar: "نموذج أولي", en: "Prototype" },
  early_revenue: { ar: "إيرادات مبكرة", en: "Early revenue" },
  scaling: { ar: "توسّع", en: "Scaling" },
  not_registered: { ar: "غير مسجّلة", en: "Not registered" },
  registered_local: { ar: "مسجّلة محليًّا", en: "Registered locally" },
  registered_foreign: { ar: "مسجّلة خارج فلسطين", en: "Registered abroad" },
  equity: { ar: "تمويل ب حصص (equity)", en: "Equity" },
  non_equity: { ar: "تمويل بلا حصص", en: "Non-equity" },
  any: { ar: "أي شكل", en: "Any" },
  bank_transfer: { ar: "تحويل بنكي", en: "Bank transfer" },
  paypal: { ar: "باي بال", en: "PayPal" },
  wise: { ar: "Wise", en: "Wise" },
  other: { ar: "أخرى", en: "Other" },
  none: { ar: "بلا", en: "None" },
  ps: { ar: "فلسطين", en: "Palestine" },
  jo: { ar: "الأردن", en: "Jordan" },
  eg: { ar: "مصر", en: "Egypt" },
  ae: { ar: "الإمارات", en: "UAE" },
  sa: { ar: "السعودية", en: "Saudi Arabia" },
  qa: { ar: "قطر", en: "Qatar" },
  kw: { ar: "الكويت", en: "Kuwait" },
  tr: { ar: "تركيا", en: "Türkiye" },
  us: { ar: "الولايات المتحدة", en: "United States" },
  gb: { ar: "بريطانيا", en: "United Kingdom" },
  de: { ar: "ألمانيا", en: "Germany" },
  fr: { ar: "فرنسا", en: "France" },
  sg: { ar: "سنغافورة", en: "Singapore" },
  ar: { ar: "العربية", en: "Arabic" },
  en: { ar: "الإنجليزية", en: "English" },
  registration_cert: { ar: "سجل تجاري", en: "Registration certificate" },
  pitch_deck: { ar: "عرض تقديمي", en: "Pitch deck" },
  financial_statements: { ar: "قوائم مالية", en: "Financial statements" },
  founder_id: { ar: "هوية المؤسس", en: "Founder ID" },
  business_plan: { ar: "خطة عمل", en: "Business plan" },
  tax_record: { ar: "سجل ضريبي", en: "Tax record" },
  bank_letter: { ar: "خطاب بنكي", en: "Bank letter" },
  prototype_demo: { ar: "عرض النموذج الأولي", en: "Prototype demo" },
  letters_of_support: { ar: "رسائل دعم", en: "Letters of support" },
};

const CHANGE_TYPE_LABELS: Record<string, BiLabel> = {
  substantive: { ar: "تغيير جوهري", en: "Substantive change" },
  non_substantive: { ar: "تغيير غير جوهري", en: "Non-substantive change" },
};

const STATUS_LABELS: Record<string, BiLabel> = {
  SATISFIED: { ar: "مستوفى", en: "Satisfied" },
  NOT_SATISFIED: { ar: "غير مستوفى", en: "Not satisfied" },
  UNRESOLVED: { ar: "غير محسوم", en: "Unresolved" },
};

const UNRESOLVED_REASON_LABELS: Record<string, BiLabel> = {
  MISSING_PROFILE_DATA: { ar: "نقص في بيانات الملف", en: "Missing profile data" },
  AMBIGUOUS_WORDING: { ar: "غموض في نص الجهة", en: "Ambiguous wording" },
  NO_EVIDENCE: { ar: "بلا دليل موثّق", en: "No documented evidence" },
  STALE_EVIDENCE: { ar: "دليل قديم (أكثر من 180 يومًا)", en: "Stale evidence (over 180 days)" },
  WEAK_EVIDENCE: { ar: "دليل ضعيف", en: "Weak evidence" },
};

// ————— أدوات عرض خالصة —————

type Lang = "ar" | "en";

function biLabel(map: Record<string, BiLabel>, key: string, lang: Lang, fallback?: string): string {
  const entry = map[key];
  if (entry) return lang === "ar" ? entry.ar : entry.en;
  return fallback ?? key;
}

function valueLabel(value: unknown, lang: Lang): string {
  if (value === null || value === undefined) return lang === "ar" ? "غير مذكور" : "Not specified";
  if (Array.isArray(value)) {
    if (value.length === 0) return lang === "ar" ? "غير مذكور" : "Not specified";
    return value.map((v) => valueLabel(v, lang)).join(lang === "ar" ? "، " : ", ");
  }
  if (typeof value === "boolean") {
    return lang === "ar" ? (value ? "نعم" : "لا") : value ? "Yes" : "No";
  }
  const key = String(value);
  if (key.trim() === "") return lang === "ar" ? "غير مذكور" : "Not specified";
  return biLabel(VALUE_LABELS, key, lang);
}

/** «المتوقع» من قاعدة الشرط (field/op/value) — نص عربي/إنجليزي واضح للعرض */
function expectedTextOfRule(cond: ConditionRuleView, lang: Lang): string {
  const field = biLabel(FIELD_LABELS, cond.field, lang);
  if (cond.op === "exists") {
    return lang === "ar" ? `«${field}»: مطلوب ذكر قيمة` : `"${field}": a value must be provided`;
  }
  if (cond.op === "between" && Array.isArray(cond.value) && cond.value.length === 2) {
    const a = valueLabel(cond.value[0], lang);
    const b = valueLabel(cond.value[1], lang);
    const phrase = biLabel(OP_PHRASES, "between", lang);
    return lang === "ar" ? `${field} ${phrase} ${a} و${b}` : `${field} ${phrase} ${a} and ${b}`;
  }
  const phrase = biLabel(OP_PHRASES, cond.op, lang, cond.op);
  const val = valueLabel(cond.value, lang);
  return `${field} ${phrase} ${val}`;
}

/** نطاق المبلغ بالعملة الصريحة */
function amountText(
  min: number | null,
  max: number | null,
  currency: string,
  lang: Lang,
  fromAr: string,
  fromEn: string,
  upToAr: string,
  upToEn: string,
  unspecifiedAr: string,
  unspecifiedEn: string,
): string {
  if (min !== null && max !== null) {
    if (min === max) return formatMoney(min, currency, lang);
    return `${formatMoney(min, currency, lang)} — ${formatMoney(max, currency, lang)}`;
  }
  if (min !== null) return `${lang === "ar" ? fromAr : fromEn} ${formatMoney(min, currency, lang)}`;
  if (max !== null) return `${lang === "ar" ? upToAr : upToEn} ${formatMoney(max, currency, lang)}`;
  return lang === "ar" ? unspecifiedAr : unspecifiedEn;
}

/** «بعد 5 أيام / قبل 3 أيام» عبر Intl.RelativeTimeFormat */
function relativeDays(iso: string | null, lang: Lang): string | null {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return null;
  const days = Math.ceil((d - Date.now()) / 86_400_000);
  try {
    return new Intl.RelativeTimeFormat(lang === "ar" ? "ar" : "en", { numeric: "auto" }).format(
      days,
      "day",
    );
  } catch {
    return null;
  }
}

/** أيام منذ تاريخ (لسلامة الدليل) */
function daysSinceIso(iso: string): number | null {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return null;
  return Math.floor((Date.now() - d) / 86_400_000);
}

/** حالة دليل الشرط تقريبيًّا (بلا ملف): missing ← stale ← ok */
function evidenceStateOfRule(
  evidence: { url: string; quote: string; verifiedAt: string } | null | undefined,
): "ok" | "missing" | "stale" {
  if (!evidence || !evidence.url || !evidence.quote) return "missing";
  const age = daysSinceIso(evidence.verifiedAt);
  if (age === null || age > 180) return "stale";
  return "ok";
}

function toastError(
  e: unknown,
  t: (ar: string, en: string) => string,
  ar: string,
  en: string,
): void {
  const message = e instanceof Error && e.message.trim() !== "" ? e.message.trim() : "";
  toast.error(message !== "" ? `${t(ar, en)} — ${message}` : t(ar, en));
}

/** حاوية تمرير طويلة بأسفل تمرير مرتب */
const SCROLLABLE_LIST =
  "max-h-96 overflow-y-auto pe-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border";

const PAGE_SIZE = 12;

// ————— بطاقة فرصة في الشبكة —————

function OpportunityCard({
  item,
  onOpen,
}: {
  item: OpportunityListItem;
  onOpen: () => void;
}) {
  const { t, lang } = useI18n();
  const rel = relativeDays(item.deadline, lang);
  const deadlinePast = item.deadline ? new Date(item.deadline).getTime() < Date.now() : false;
  const deadlineTone = deadlinePast
    ? "text-rose-600 dark:text-rose-400"
    : rel && item.deadline && new Date(item.deadline).getTime() - Date.now() < 14 * 86_400_000
      ? "text-amber-600 dark:text-amber-400"
      : "text-muted-foreground";

  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
      className="h-full"
    >
      <Card
        role="button"
        tabIndex={0}
        aria-label={`${item.title} — ${item.orgName}`}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className="h-full cursor-pointer outline-none transition-shadow hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <CardContent className="flex h-full flex-col gap-3 p-4 sm:p-5">
          <div className="space-y-1.5">
            <h3 className="line-clamp-2 font-semibold leading-snug">{item.title}</h3>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.orgName}</span>
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="bg-emerald-600/12 text-emerald-700 dark:text-emerald-400">
              {biLabel(OPP_TYPE_LABELS, item.type, lang)}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Globe2 className="h-3 w-3" aria-hidden="true" />
              {biLabel(GEOGRAPHY_LABELS, item.geography, lang)}
            </Badge>
            {item.sectors[0] ? (
              <Badge variant="outline">{biLabel(SECTOR_LABELS, item.sectors[0], lang)}</Badge>
            ) : null}
          </div>

          <div className="mt-auto space-y-2.5 pt-1">
            <p className="flex items-center gap-1.5 text-sm font-bold text-primary">
              <Briefcase className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {amountText(
                  item.amountMin,
                  item.amountMax,
                  item.currency,
                  lang,
                  t("من", "From"),
                  t("From", "From"),
                  t("حتى", "Up to"),
                  t("Up to", "Up to"),
                  t("المبلغ غير محدد", "Amount unspecified"),
                  t("Amount unspecified", "Amount unspecified"),
                )}
              </span>
            </p>
            <p className={`flex items-center gap-1.5 text-sm ${deadlineTone}`}>
              <Calendar className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {item.deadline ? formatDate(item.deadline, lang) : t("بلا موعد نهائي", "No deadline")}
                {rel ? <span className="text-xs"> · {rel}</span> : null}
              </span>
            </p>
            <ReliabilityMeter
              total={item.reliability.total}
              level={item.reliability.level}
              warningAr={item.reliability.warningAr}
              warningEn={item.reliability.warningEn}
            />
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ————— بطاقة شرط واحدة (قاعدة الفرصة + إثراء حكمك إن توفر) —————

function ConditionRuleCard({
  cond,
  mine,
}: {
  cond: ConditionRuleView;
  mine: MatchConditionLite | null;
}) {
  const { t, lang } = useI18n();
  const ruleState = mine ? mine.evidenceState : evidenceStateOfRule(cond.evidence);
  const isStale = ruleState === "stale";
  const isMissing = ruleState === "missing";
  const isWeak = ruleState === "weak";
  const evidenceOk = ruleState === "ok";
  const ageDays = cond.evidence ? daysSinceIso(cond.evidence.verifiedAt) : null;

  return (
    <div
      className={`rounded-xl border p-4 ${
        isMissing
          ? "border-rose-400/50 bg-rose-50/40 dark:bg-rose-950/20"
          : isStale || isWeak
            ? "border-amber-400/50 bg-amber-50/40 dark:bg-amber-950/20"
            : "border-border bg-card"
      }`}
    >
      {/* رأس البطاقة: الحقل + الشرائط */}
      <div className="flex flex-wrap items-center gap-1.5">
        <h4 className="me-auto text-sm font-semibold">
          {biLabel(FIELD_LABELS, cond.field, lang)}
        </h4>
        {cond.mandatory ? (
          <Badge className="bg-rose-600/15 text-rose-700 hover:bg-rose-600/15 dark:text-rose-400">
            {t("إلزامي", "Mandatory")}
          </Badge>
        ) : (
          <Badge variant="secondary">{t("غير إلزامي", "Optional")}</Badge>
        )}
        {cond.ambiguous ? (
          <Badge className="gap-1 bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            {t("صياغة غامضة", "Ambiguous")}
          </Badge>
        ) : null}
        {cond.field.startsWith("founder.") ? (
          <Badge variant="outline">
            {cond.scope === "any"
              ? t("يكفي مؤسس واحد", "Any one founder suffices")
              : t("جميع المؤسسين", "All founders")}
          </Badge>
        ) : null}
      </div>

      {/* المتوقع + قيمة ملفك */}
      <div className="mt-3 space-y-1.5 text-sm">
        <p>
          <span className="font-medium text-muted-foreground">{t("المتوقع:", "Expected:")}</span>{" "}
          {expectedTextOfRule(cond, lang)}
        </p>
        {mine ? (
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-muted-foreground">{t("قيمة ملفك:", "Your value:")}</span>
            <span>{mine.actual}</span>
            <Badge
              variant="outline"
              className={
                mine.status === "SATISFIED"
                  ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                  : mine.status === "NOT_SATISFIED"
                    ? "border-rose-500/40 text-rose-700 dark:text-rose-400"
                    : "border-amber-500/40 text-amber-700 dark:text-amber-400"
              }
            >
              {biLabel(STATUS_LABELS, mine.status, lang)}
            </Badge>
            {mine.unresolvedReason ? (
              <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
                {biLabel(UNRESOLVED_REASON_LABELS, mine.unresolvedReason, lang)}
              </Badge>
            ) : null}
          </p>
        ) : null}
      </div>

      {/* عبارة الجهة الأصلية */}
      {cond.sourceWording && cond.sourceWording.trim() !== "" ? (
        <blockquote
          className="mt-3 rounded-lg border-s-4 border-emerald-600/50 bg-muted/60 ps-3 py-2 text-sm italic leading-relaxed"
          cite={cond.evidence?.url ?? undefined}
        >
          <span className="sr-only">{t("عبارة الجهة الأصلية:", "Original source wording:")}</span>
          <Quote className="me-1 inline h-3.5 w-3.5 -translate-y-0.5 text-emerald-600/70" aria-hidden="true" />
          {cond.sourceWording}
        </blockquote>
      ) : null}

      {/* الدليل */}
      <div className="mt-3 space-y-2 rounded-lg bg-muted/40 p-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-semibold text-muted-foreground">{t("الدليل:", "Evidence:")}</span>
          {evidenceOk ? (
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              {t("موثّق", "Documented")}
            </Badge>
          ) : isStale ? (
            <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
              {t("أقدم من 180 يومًا", "Older than 180 days")}
            </Badge>
          ) : isWeak ? (
            <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
              {t("دليل ضعيف", "Weak evidence")}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-rose-500/50 text-rose-700 dark:text-rose-400">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {t("دليل ناقص — بلا رابط أو اقتباس", "Missing evidence — no link or quote")}
            </Badge>
          )}
        </div>

        {cond.evidence ? (
          <div className="space-y-1.5">
            <a
              href={cond.evidence.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-emerald-700 underline decoration-emerald-600/40 underline-offset-2 hover:decoration-emerald-600 dark:text-emerald-400"
              aria-label={t("فتح مصدر الدليل في نافذة جديدة", "Open evidence source in a new tab")}
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="break-all">{cond.evidence.url}</span>
            </a>
            {cond.evidence.quote && cond.evidence.quote.trim() !== "" ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                <span className="sr-only">{t("اقتباس من المصدر:", "Quote from source:")}</span>
                «{cond.evidence.quote}»
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {t("آخر تحقق:", "Last verified:")}{" "}
              <time dateTime={cond.evidence.verifiedAt}>
                {formatDate(cond.evidence.verifiedAt, lang)}
              </time>
              {ageDays !== null && ageDays >= 0 ? (
                <span className="text-xs"> · {t(`قبل ${ageDays} يومًا`, `${ageDays} days ago`)}</span>
              ) : null}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t(
              "لا يوجد دليل موثّق لهذا الشرط — عُلم ناقصًا لحين توثيقه من مصدر الجهة.",
              "No documented evidence for this condition — flagged as missing until verified from the source.",
            )}
          </p>
        )}
      </div>
    </div>
  );
}

// ————— إشارات الموثوقية الأربع (تفصيل) —————

function ReliabilitySignals({ reliability }: { reliability: ReliabilityFull }) {
  const { t, lang } = useI18n();
  const signals = Array.isArray(reliability.signals) ? reliability.signals : [];
  return (
    <div className="space-y-2.5">
      {signals.map((sig) => {
        const ratio = sig.weight > 0 ? Math.min(1, Math.max(0, sig.score / sig.weight)) : 0;
        const tone =
          ratio >= 0.8
            ? "bg-emerald-600 dark:bg-emerald-500"
            : ratio >= 0.5
              ? "bg-amber-500"
              : "bg-rose-500";
        return (
          <div key={sig.key} className="rounded-lg border bg-muted/30 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{lang === "ar" ? sig.labelAr : sig.labelEn ?? sig.key}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{lang === "ar" ? sig.detail : sig.detailEn ?? "Calculated from the available source and opportunity data."}</p>
              </div>
              <span className="shrink-0 text-xs font-bold text-muted-foreground" dir="ltr">
                {sig.score}/{sig.weight}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border" aria-hidden="true">
              <div
                className={`h-full rounded-full transition-all ${tone}`}
                style={{ width: `${Math.round(ratio * 100)}%` }}
              />
            </div>
          </div>
        );
      })}
      {reliability.warningAr ? (
        <p
          className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300"
          role="status"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{lang === "ar" ? reliability.warningAr : reliability.warningEn ?? "The source is old or has weak supporting evidence. Verify it before relying on this assessment."}</span>
        </p>
      ) : null}
      {signals.length === 0 && !reliability.warningAr ? (
        <p className="text-sm text-muted-foreground">
          {t("لا تفصيل إشارات متاح لهذه الفرصة.", "No signal breakdown available for this opportunity.")}
        </p>
      ) : null}
      <span className="sr-only">{lang === "ar" ? "إشارات الموثوقية" : "Reliability signals"}</span>
    </div>
  );
}

// ————— المكون الرئيسي —————

export default function OpportunitiesView({ params }: ViewProps) {
  const { t, lang } = useI18n();

  // بحث وفلاتر
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [type, setType] = useState("all");
  const [geography, setGeography] = useState("all");
  const [sector, setSector] = useState("all");
  const [sort, setSort] = useState<"deadline" | "newest">("deadline");

  // القائمة والترقيم
  const [items, setItems] = useState<OpportunityListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestIdRef = useRef(0);

  // التفاصيل
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OpportunityDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailNonce, setDetailNonce] = useState(0);

  // التتبّع والإثراء
  const [trackingIds, setTrackingIds] = useState<ReadonlySet<string>>(new Set());
  const [trackPending, setTrackPending] = useState<string | null>(null);
  const [matchIndex, setMatchIndex] = useState<Map<string, MatchConditionLite[]> | null>(null);

  const initialOppId = typeof params?.opportunityId === "string" ? params.opportunityId : null;

  // بحث debounced
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 400);
    return () => clearTimeout(timer);
  }, [query]);

  // فتح فرصة من params (تنقّل خارجي — إشعار مثلًا)
  useEffect(() => {
    if (initialOppId) setSelectedId(initialOppId);
  }, [initialOppId]);

  // جلب الصفحة الأولى عند تغيّر أي فلتر
  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    const sp = new URLSearchParams();
    if (debouncedQuery !== "") sp.set("q", debouncedQuery);
    if (type !== "all") sp.set("type", type);
    if (geography !== "all") sp.set("geography", geography);
    if (sector !== "all") sp.set("sector", sector);
    sp.set("sort", sort);
    sp.set("skip", "0");
    sp.set("take", String(PAGE_SIZE));
    api
      .get<OpportunityListResponse>(`/opportunities?${sp.toString()}`)
      .then((res) => {
        if (requestId !== requestIdRef.current) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((e) => {
        if (requestId !== requestIdRef.current) return;
        setItems([]);
        setTotal(0);
        toastError(e, t, "تعذّر تحميل قائمة الفرص", "Failed to load opportunities");
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
    // t ثابت الدلالة — لا نعيد الجلب عند تبديل اللغة
  }, [debouncedQuery, type, geography, sector, sort]);

  // تحميل تدريجي
  function loadMore() {
    if (loadingMore || loading || items.length >= total) return;
    const requestId = ++requestIdRef.current;
    setLoadingMore(true);
    const sp = new URLSearchParams();
    if (debouncedQuery !== "") sp.set("q", debouncedQuery);
    if (type !== "all") sp.set("type", type);
    if (geography !== "all") sp.set("geography", geography);
    if (sector !== "all") sp.set("sector", sector);
    sp.set("sort", sort);
    sp.set("skip", String(items.length));
    sp.set("take", String(PAGE_SIZE));
    api
      .get<OpportunityListResponse>(`/opportunities?${sp.toString()}`)
      .then((res) => {
        if (requestId !== requestIdRef.current) return;
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...res.items.filter((r) => !seen.has(r.id))];
        });
        setTotal(res.total);
      })
      .catch((e) => {
        if (requestId !== requestIdRef.current) return; // استجابة قديمة بعد تغيّر الفلاتر
        toastError(e, t, "تعذّر تحميل المزيد من الفرص", "Failed to load more opportunities");
      })
      .finally(() => {
        setLoadingMore(false);
      });
  }

  // حالة التتبّع الحالية (لترميم الأزرار) + إثراء أحكام الشروط — بداية الشاشة
  useEffect(() => {
    api
      .get<ApplicationsResponse>("/applications")
      .then((r) => {
        const ids = new Set<string>();
        for (const a of r.applications) {
          if (a.opportunity?.id) ids.add(a.opportunity.id);
        }
        setTrackingIds(ids);
      })
      .catch(() => undefined); // صامت: قد يختلف الدور — الأخطاء تظهر عند التتبّع نفسه
    api
      .get<MatchLite[]>("/matches")
      .then((ms) => {
        const idx = new Map<string, MatchConditionLite[]>();
        for (const m of ms) idx.set(m.opportunity.id, m.conditions);
        setMatchIndex(idx);
      })
      .catch(() => undefined); // صامت: إثراء اختياري
  }, []);

  // تفاصيل الفرصة عند اختيارها
  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetail(null);
    setDetailError(null);
    api
      .get<OpportunityDetail>(`/opportunities/${selectedId}`)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) {
          setDetailError(
            e instanceof Error && e.message.trim() !== "" ? e.message : t("خطأ غير متوقع", "Unexpected error"),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // detailNonce لإعادة المحاولة — t ثابت
  }, [selectedId, detailNonce]);

  // تتبّع فرصة
  async function trackOpportunity(oppId: string) {
    if (trackingIds.has(oppId) || trackPending !== null) return;
    setTrackPending(oppId);
    try {
      await api.post("/applications", { opportunityId: oppId, status: "INTERESTED" });
      setTrackingIds((prev) => new Set(prev).add(oppId));
      toast.success(t("تمت إضافة الفرصة إلى متتبع الطلبات", "Opportunity added to your tracker"));
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      if (message.includes("تتابع") || message.includes("ALREADY")) {
        // 409: تتبّع موجود مسبقًا — نزامن الواجهة
        setTrackingIds((prev) => new Set(prev).add(oppId));
        toast.info(t("أنت تتابع هذه الفرصة بالفعل", "You already track this opportunity"));
      } else {
        toastError(e, t, "تعذّر تتبّع الفرصة", "Failed to track the opportunity");
      }
    } finally {
      setTrackPending(null);
    }
  }

  function resetFilters() {
    setQuery("");
    setDebouncedQuery("");
    setType("all");
    setGeography("all");
    setSector("all");
    setSort("deadline");
  }

  const hasActiveFilters =
    debouncedQuery !== "" || type !== "all" || geography !== "all" || sector !== "all" || sort !== "deadline";

  const myConditions = useMemo(
    () => (selectedId !== null ? (matchIndex?.get(selectedId) ?? null) : null),
    [selectedId, matchIndex],
  );

  function findMyCondition(cond: ConditionRuleView): MatchConditionLite | null {
    if (!myConditions) return null;
    return myConditions.find((c) => c.field === cond.field && c.op === cond.op) ?? null;
  }

  const sectorOptions = useMemo(() => Object.keys(SECTOR_LABELS), []);

  return (
    <div className="space-y-6">
      {/* ————— البحث والفلاتر ————— */}
      <section aria-label={t("البحث والفلاتر", "Search and filters")} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div className="space-y-1.5 xl:col-span-2">
            <label htmlFor="opp-search" className="text-xs font-medium text-muted-foreground">
              {t("بحث", "Search")}
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="opp-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("ابحث بعنوان الفرصة أو الجهة…", "Search by title or organization…")}
                className="h-11 ps-10"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="opp-type" className="text-xs font-medium text-muted-foreground">
              {t("النوع", "Type")}
            </label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="opp-type" className="h-11 w-full">
                <SelectValue placeholder={t("كل الأنواع", "All types")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="h-11">
                  {t("كل الأنواع", "All types")}
                </SelectItem>
                {Object.keys(OPP_TYPE_LABELS).map((key) => (
                  <SelectItem key={key} value={key} className="h-11">
                    {biLabel(OPP_TYPE_LABELS, key, lang)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="opp-geo" className="text-xs font-medium text-muted-foreground">
              {t("الجغرافيا", "Geography")}
            </label>
            <Select value={geography} onValueChange={setGeography}>
              <SelectTrigger id="opp-geo" className="h-11 w-full">
                <SelectValue placeholder={t("كل النطاقات", "All scopes")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="h-11">
                  {t("كل النطاقات", "All scopes")}
                </SelectItem>
                {Object.keys(GEOGRAPHY_LABELS).map((key) => (
                  <SelectItem key={key} value={key} className="h-11">
                    {biLabel(GEOGRAPHY_LABELS, key, lang)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="opp-sector" className="text-xs font-medium text-muted-foreground">
              {t("القطاع", "Sector")}
            </label>
            <Select value={sector} onValueChange={setSector}>
              <SelectTrigger id="opp-sector" className="h-11 w-full">
                <SelectValue placeholder={t("كل القطاعات", "All sectors")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="h-11">
                  {t("كل القطاعات", "All sectors")}
                </SelectItem>
                {sectorOptions.map((key) => (
                  <SelectItem key={key} value={key} className="h-11">
                    {biLabel(SECTOR_LABELS, key, lang)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="opp-sort" className="text-xs font-medium text-muted-foreground">
              {t("الترتيب", "Sort")}
            </label>
            <Select value={sort} onValueChange={(v) => setSort(v === "newest" ? "newest" : "deadline")}>
              <SelectTrigger id="opp-sort" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="deadline" className="h-11">
                  {t("الموعد الأقرب", "Nearest deadline")}
                </SelectItem>
                <SelectItem value="newest" className="h-11">
                  {t("الأحدث إضافة", "Newest first")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {loading
              ? t("جارٍ التحميل…", "Loading…")
              : t(`عرض ${items.length} من ${total} فرصة`, `Showing ${items.length} of ${total} opportunities`)}
          </p>
          {hasActiveFilters ? (
            <Button variant="ghost" className="h-11 gap-1.5" onClick={resetFilters}>
              <X className="h-4 w-4" aria-hidden="true" />
              {t("مسح الفلاتر", "Clear filters")}
            </Button>
          ) : null}
        </div>
      </section>

      {/* ————— شبكة الفرص ————— */}
      <section aria-label={t("قائمة الفرص", "Opportunities list")} aria-busy={loading}>
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-56 w-full rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            iconAr="∅"
            title={t("لا فرص مطابقة", "No matching opportunities")}
            hintAr={
              hasActiveFilters
                ? t(
                    "لم تُطابق نتائج البحث والفلاتر الحالية. جرّب تعديلها أو مسحها.",
                    "No results for the current search and filters. Try adjusting or clearing them.",
                  )
                : t(
                    "لا توجد فرص منشورة حاليًّا — عُد لاحقًا، تُراجَع الفرص وتُنشر بعد توثيق شروطها.",
                    "No published opportunities yet — check back later; opportunities are reviewed and published after their conditions are verified.",
                  )
            }
            action={
              hasActiveFilters ? (
                <Button variant="outline" className="h-11" onClick={resetFilters}>
                  {t("مسح الفلاتر", "Clear filters")}
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <OpportunityCard key={item.id} item={item} onOpen={() => setSelectedId(item.id)} />
              ))}
            </div>

            {items.length < total ? (
              <div className="mt-6 flex flex-col items-center gap-2">
                <Button
                  variant="outline"
                  className="h-11 min-w-44"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      {t("جارٍ التحميل…", "Loading…")}
                    </>
                  ) : (
                    t("المزيد", "Load more")
                  )}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {t(
                    `${items.length} من ${total}`,
                    `${items.length} of ${total}`,
                  )}
                </p>
              </div>
            ) : null}
          </>
        )}
      </section>

      {/* ————— Dialog تفاصيل الفرصة ————— */}
      <Dialog
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          {/* عنوان وصف دائمان للقرّاء (Radix يتطلب عنوانًا) — الرأس المرئي داخل المحتوى */}
          <DialogHeader className="sr-only">
            <DialogTitle>
              {detail ? detail.title : t("تفاصيل الفرصة", "Opportunity details")}
            </DialogTitle>
            <DialogDescription>
              {detail ? detail.orgName : t("تفاصيل الفرصة وأدلة شروطها", "Opportunity details and condition evidence")}
            </DialogDescription>
          </DialogHeader>
          <div className={`flex-1 overflow-y-auto px-5 pb-2 pt-5 sm:px-6 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border`}>
            {detailLoading ? (
              <div className="space-y-4" aria-busy="true">
                <Skeleton className="h-7 w-3/4" />
                <Skeleton className="h-5 w-1/2" />
                <div className="flex gap-1.5">
                  <Skeleton className="h-6 w-20 rounded-md" />
                  <Skeleton className="h-6 w-16 rounded-md" />
                  <Skeleton className="h-6 w-24 rounded-md" />
                </div>
                <Skeleton className="h-20 w-full rounded-xl" />
                <Skeleton className="h-40 w-full rounded-xl" />
                <Skeleton className="h-56 w-full rounded-xl" />
              </div>
            ) : detailError !== null ? (
              <div className="space-y-4 py-8 text-center">
                <AlertTriangle
                  className="mx-auto h-10 w-10 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
                <p className="text-sm text-muted-foreground">{detailError}</p>
                <Button
                  variant="outline"
                  className="h-11"
                  onClick={() => setDetailNonce((n) => n + 1)}
                >
                  {t("إعادة المحاولة", "Retry")}
                </Button>
              </div>
            ) : detail ? (
              <div className="space-y-6">
                {/* الرأس المرئي */}
                <div className="space-y-2 text-start">
                  <h2 className="text-xl font-bold leading-snug">{detail.title}</h2>
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{detail.orgName}</span>
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge className="bg-emerald-600/12 text-emerald-700 hover:bg-emerald-600/12 dark:text-emerald-400">
                    {biLabel(OPP_TYPE_LABELS, detail.type, lang)}
                  </Badge>
                  <Badge variant="outline" className="gap-1">
                    <Globe2 className="h-3 w-3" aria-hidden="true" />
                    {biLabel(GEOGRAPHY_LABELS, detail.geography, lang)}
                  </Badge>
                  {detail.sectors.slice(0, 3).map((s) => (
                    <Badge key={s} variant="outline">
                      {biLabel(SECTOR_LABELS, s, lang)}
                    </Badge>
                  ))}
                  {detail.sectors.length > 3 ? (
                    <Badge variant="outline">
                      {t(`+${detail.sectors.length - 3}`, `+${detail.sectors.length - 3}`)}
                    </Badge>
                  ) : null}
                  {detail.verifiedAt ? (
                    <Badge variant="outline" className="gap-1 border-emerald-600/40 text-emerald-700 dark:text-emerald-400">
                      <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                      {t("تم التحقق", "Verified")} {formatDate(detail.verifiedAt, lang)}
                    </Badge>
                  ) : null}
                </div>

                {/* الحقائق الأساسية */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border bg-muted/30 p-3.5">
                    <p className="text-xs font-medium text-muted-foreground">{t("المبلغ", "Amount")}</p>
                    <p className="mt-1 text-sm font-bold text-primary">
                      {amountText(
                        detail.amountMin,
                        detail.amountMax,
                        detail.currency,
                        lang,
                        t("من", "From"),
                        t("From", "From"),
                        t("حتى", "Up to"),
                        t("Up to", "Up to"),
                        t("غير محدد", "Unspecified"),
                        t("Unspecified", "Unspecified"),
                      )}
                    </p>
                  </div>
                  <div className="rounded-xl border bg-muted/30 p-3.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t("الموعد النهائي", "Deadline")}
                    </p>
                    <p className="mt-1 text-sm font-bold">
                      {detail.deadline ? formatDate(detail.deadline, lang) : t("بلا موعد", "None")}
                      {detail.deadline ? (
                        <span className="ms-2 text-xs font-normal text-muted-foreground">
                          {relativeDays(detail.deadline, lang) ?? ""}
                        </span>
                      ) : null}
                    </p>
                    {detail.deadline && detail.deadlineTz ? (
                      <p className="mt-0.5 text-xs text-muted-foreground" dir="ltr">
                        {detail.deadlineTz}
                      </p>
                    ) : null}
                  </div>
                  {detail.stageMin || detail.stageMax ? (
                    <div className="rounded-xl border bg-muted/30 p-3.5">
                      <p className="text-xs font-medium text-muted-foreground">{t("المرحلة", "Stage")}</p>
                      <p className="mt-1 text-sm font-bold">
                        {[
                          detail.stageMin ? valueLabel(detail.stageMin, lang) : null,
                          detail.stageMax ? valueLabel(detail.stageMax, lang) : null,
                        ]
                          .filter(Boolean)
                          .join(" — ")}
                      </p>
                    </div>
                  ) : null}
                  <div className="rounded-xl border bg-muted/30 p-3.5">
                    <p className="text-xs font-medium text-muted-foreground">{t("لغات التقديم", "Languages")}</p>
                    <p className="mt-1 text-sm font-bold">{valueLabel(detail.languages, lang)}</p>
                  </div>
                </div>

                {/* الوصف */}
                {detail.description ? (
                  <section aria-label={t("وصف الفرصة", "Opportunity description")}>
                    <h3 className="mb-2 text-sm font-semibold">{t("الوصف", "Description")}</h3>
                    <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                      {detail.description}
                    </p>
                  </section>
                ) : null}

                {/* الموثوقية */}
                <section aria-label={t("موثوقية الفرصة", "Opportunity reliability")}>
                  <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                    <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    {t("موثوقية الفرصة", "Opportunity reliability")}
                  </h3>
                  <div className="space-y-3">
                    <ReliabilityMeter
                      total={detail.reliability.total}
                      level={detail.reliability.level}
                      warningAr={detail.reliability.warningAr}
                      warningEn={detail.reliability.warningEn}
                    />
                    <ReliabilitySignals reliability={detail.reliability} />
                  </div>
                </section>

                {/* الشروط */}
                <section aria-label={t("شروط الفرصة بأدلتها", "Opportunity conditions with evidence")}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                      <Layers className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                      {t("الشروط", "Conditions")} ({detail.conditions.length})
                    </h3>
                    {myConditions ? (
                      <span className="text-xs text-muted-foreground">
                        {t("مقرونة بقيمة ملفك وحالة كل شرط", "Paired with your profile values and each condition's status")}
                      </span>
                    ) : null}
                  </div>
                  {detail.conditions.length === 0 ? (
                    <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                      {t(
                        "لا شروط منظّمة لهذه الفرصة — راجع صفحة الجهة للتفاصيل.",
                        "No structured conditions for this opportunity — see the source page for details.",
                      )}
                    </p>
                  ) : (
                    <div className={`space-y-3 ${SCROLLABLE_LIST}`}>
                      {detail.conditions.map((cond) => (
                        <ConditionRuleCard key={cond.id} cond={cond} mine={findMyCondition(cond)} />
                      ))}
                    </div>
                  )}
                </section>

                {/* المستندات المطلوبة */}
                {detail.requiresDocs.length > 0 ? (
                  <section aria-label={t("المستندات المطلوبة", "Required documents")}>
                    <h3 className="mb-2 text-sm font-semibold">{t("المستندات المطلوبة", "Required documents")}</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {detail.requiresDocs.map((doc) => (
                        <Badge key={doc} variant="outline">
                          {valueLabel(doc, lang)}
                        </Badge>
                      ))}
                    </div>
                  </section>
                ) : null}

                {/* آخر النسخ */}
                {detail.versions.length > 0 ? (
                  <section aria-label={t("سجل النسخ", "Version history")}>
                    <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                      <History className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                      {t("آخر النسخ", "Recent versions")}
                    </h3>
                    <ol className="space-y-2">
                      {detail.versions.map((v) => (
                        <li
                          key={v.versionNumber}
                          className={`flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm ${
                            v.changeType === "substantive"
                              ? "border-amber-500/40 bg-amber-500/5"
                              : "border-border bg-muted/30"
                          }`}
                        >
                          <Badge variant="outline" className="shrink-0">
                            {t(`نسخة ${v.versionNumber}`, `Version ${v.versionNumber}`)}
                          </Badge>
                          <span
                            className={
                              v.changeType === "substantive"
                                ? "font-medium text-amber-700 dark:text-amber-400"
                                : "text-muted-foreground"
                            }
                          >
                            {biLabel(CHANGE_TYPE_LABELS, v.changeType, lang, v.changeType)}
                          </span>
                          <span className="text-xs text-muted-foreground">{formatDate(v.createdAt, lang)}</span>
                          {v.reason && v.reason.trim() !== "" ? (
                            <p className="w-full text-xs leading-relaxed text-muted-foreground">{v.reason}</p>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  </section>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* شريط الإجراءات السفلي */}
          {detail && !detailLoading ? (
            <div className="border-t bg-card/95 px-5 py-4 sm:px-6">
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                {detail.applicationUrl ? (
                  <Button variant="outline" className="h-11 gap-1.5" asChild>
                    <a href={detail.applicationUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                      {t("فتح صفحة التقديم", "Open application page")}
                    </a>
                  </Button>
                ) : null}
                <Button
                  className="h-11 gap-1.5"
                  disabled={trackingIds.has(detail.id) || trackPending !== null}
                  onClick={() => trackOpportunity(detail.id)}
                >
                  {trackPending === detail.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : trackingIds.has(detail.id) ? (
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Bell className="h-4 w-4" aria-hidden="true" />
                  )}
                  {trackingIds.has(detail.id)
                    ? t("قيد التتبع", "Tracking")
                    : trackPending === detail.id
                      ? t("جارٍ الإضافة…", "Adding…")
                      : t("تتبّع هذه الفرصة", "Track this opportunity")}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
