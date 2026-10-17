"use client";

/**
 * Masar — T17: ProfileView — «ملف الشركة يسجّل مصدر كل حقل»
 * ---------------------------------------------------------------------------
 *  - GET /auth/me (تأكيد الجلسة — §15) ثم GET /profile لبيانات الملف.
 *  - بطاقة مصغّرة لكل حقل من PROFILE_FIELD_KEYS: القيمة + مصدرها
 *    («مصدر يدوي» أو «من العرض — نسخة V، شريحة N») مع tooltip بالاقتباس
 *    الحرفي (quote) وتاريخ التأكيد (confirmedAt). الناقص = «غير مذكور» + زر إضافة.
 *  - تحرير بنموذج بأقسام: أساسية / جغرافية وقانونية / تمويل / أداء / مؤسسون.
 *  - حفظ: PUT /profile بالحقول المتغيرة، وقائمة المؤسسين كاملة عند تغيرها.
 *    يتحقق الخادم من وجود مؤسس أساسي واحد ويحفظ الحقول والمؤسسين داخل معاملة واحدة.
 *  - بطاقة تلميح أعلى الشاشة: الحقول القادمة من العرض تُحدَّث عبر تأكيد الاستخراج.
 *  - يقبل params.whatIf {fields:[...]} من المحاكي «ماذا لو» لتعبئة النموذج مبدئيًا.
 *
 * هذا الملف يحمل أيضًا التصديرات المشتركة لملفات T17 الثلاثة (أنواع API، خرائط
 * التسميات ثنائية اللغة، JudgmentBadge/ScoreBar/StatCard/SCROLL_TW) — تُعرَّف هنا
 * وتُستورد في WhatIfView/QuickCheckView بلا استيراد دائري، لأن مكوّنات T16
 * المشتركة لم تُسلَّم بعد (موثَّق في worklog).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Building2,
  CheckCircle2,
  FileStack,
  HelpCircle,
  Info,
  Landmark,
  ListChecks,
  Loader2,
  LogIn,
  MapPin,
  PencilLine,
  Plus,
  RefreshCw,
  Save,
  TrendingUp,
  Users,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { api } from "@/lib/api-client";
import { useI18n, formatDate, formatMoney } from "@/components/app/i18n";
import type { ViewProps } from "@/components/app/types";
import {
  COUNTRY_KEYS,
  LEGAL_STATUS_VALUES,
  PROFILE_FIELD_KEYS,
  REGION_VALUES,
  SECTOR_KEYS,
  STAGE_KEYS,
} from "@/lib/core/types";
import type { FitFactorResult, Judgment } from "@/lib/core/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

// —————————————————————————————— أنواع API (أشكال الرد الفعلية) ——————————————————————————————

export interface StoredProfileField {
  field: string;
  value: unknown;
  source: "manual" | "deck";
  deckId?: string;
  deckVersion?: number;
  page?: number;
  quote?: string;
  confirmedAt?: string;
}

export interface FounderView {
  id: string;
  name: string | null;
  region: string | null;
  nationality: string | null;
  isPrimary: boolean;
}

export interface DocumentView {
  docType: string;
  status: "available" | "missing" | "expired";
  source: string | null;
  notes: string | null;
  updatedAt: string;
}

export interface ProfileData {
  id: string;
  fields: StoredProfileField[];
  founders: FounderView[];
  documents: DocumentView[];
  updatedAt: string;
}

/** الفرصة compact كما تعيدها /matches و/quick-check (buildMatchesForSnapshot). */
export interface CompactOpportunity {
  id: string;
  title: string;
  orgName: string;
  type: string;
  amounts: { min: number | null; max: number | null; currency: string };
  sectors: string[];
  geography: string;
  deadline: string | null;
  verifiedAt: string | null;
  applicationUrl: string | null;
  currentVersion: number;
}

/** عنصر الرد في ماذا لو (toMatchResponse). */
export interface MatchResponse {
  opportunity: CompactOpportunity;
  judgment: Judgment;
  summary: string;
  summaryEn?: string;
  blockingReasons: string[];
  blockingReasonsEn?: string[];
  uncertainReasons: string[];
  uncertainReasonsEn?: string[];
  fit: { total: number; factors: FitFactorResult[] } | null;
  reliability: { total: number; level: string; warningAr?: string; warningEn?: string };
}

export interface JudgmentChange {
  opportunityId: string;
  title: string;
  oldJudgment: Judgment;
  newJudgment: Judgment;
}

export interface WhatIfResponse {
  matches: MatchResponse[];
  changed: JudgmentChange[];
}

/** عنصر الرد في الفحص السريع (toQuickMatchResponse). */
export interface QuickMatchResponse {
  opportunity: CompactOpportunity;
  judgment: Judgment;
  summary: string;
  summaryEn?: string;
  uncertainReasons: string[];
  uncertainReasonsEn?: string[];
  fit: { total: number; factors: FitFactorResult[] } | null;
}

/** حقل يُنقل من المحاكي إلى نموذج الملف عبر onNavigate("profile", {whatIf:{fields}}). */
export interface WhatIfTransferField {
  field: string;
  value: unknown;
}

// —————————————————————————————— قاموس التسميات (ثنائي اللغة، موضعي §15) ——————————————————————————————

export interface Bi {
  ar: string;
  en: string;
}

export const SECTOR_LABELS: Record<string, Bi> = {
  agritech: { ar: "تقنية زراعية", en: "Agritech" },
  fintech: { ar: "تقنية مالية", en: "Fintech" },
  healthtech: { ar: "تقنية صحية", en: "Healthtech" },
  edtech: { ar: "تقنية تعليمية", en: "Edtech" },
  cleantech: { ar: "تقنية بيئية", en: "Cleantech" },
  iot: { ar: "إنترنت الأشياء", en: "IoT" },
  ecommerce: { ar: "تجارة إلكترونية", en: "E-commerce" },
  logistics: { ar: "خدمات لوجستية", en: "Logistics" },
  tourism: { ar: "سياحة", en: "Tourism" },
  food: { ar: "غذاء", en: "Food" },
  manufacturing: { ar: "تصنيع", en: "Manufacturing" },
  software: { ar: "برمجيات", en: "Software" },
  ai: { ar: "ذكاء اصطناعي", en: "AI" },
  water: { ar: "مياه", en: "Water" },
  energy: { ar: "طاقة", en: "Energy" },
  social: { ar: "أثر اجتماعي", en: "Social impact" },
  media: { ar: "إعلام", en: "Media" },
  other: { ar: "أخرى", en: "Other" },
};

export const STAGE_LABELS: Record<string, Bi> = {
  idea: { ar: "فكرة", en: "Idea" },
  prototype: { ar: "نموذج أولي", en: "Prototype" },
  early_revenue: { ar: "إيرادات أولى", en: "Early revenue" },
  scaling: { ar: "نمو وتوسع", en: "Scaling" },
};

export const REGION_LABELS: Record<string, Bi> = {
  west_bank: { ar: "الضفة الغربية", en: "West Bank" },
  gaza: { ar: "قطاع غزة", en: "Gaza" },
  east_jerusalem: { ar: "القدس الشرقية", en: "East Jerusalem" },
  inside_48: { ar: "الداخل الفلسطيني (48)", en: "Inside ’48 territories" },
  diaspora: { ar: "الشتات", en: "Diaspora" },
};

export const COUNTRY_LABELS: Record<string, Bi> = {
  ps: { ar: "فلسطين", en: "Palestine" },
  jo: { ar: "الأردن", en: "Jordan" },
  eg: { ar: "مصر", en: "Egypt" },
  ae: { ar: "الإمارات", en: "UAE" },
  sa: { ar: "السعودية", en: "Saudi Arabia" },
  qa: { ar: "قطر", en: "Qatar" },
  kw: { ar: "الكويت", en: "Kuwait" },
  tr: { ar: "تركيا", en: "Türkiye" },
  us: { ar: "الولايات المتحدة", en: "United States" },
  gb: { ar: "المملكة المتحدة", en: "United Kingdom" },
  de: { ar: "ألمانيا", en: "Germany" },
  fr: { ar: "فرنسا", en: "France" },
  sg: { ar: "سنغافورة", en: "Singapore" },
  other: { ar: "دولة أخرى", en: "Other country" },
  none: { ar: "غير مسجلة", en: "Not registered" },
};

export const LEGAL_STATUS_LABELS: Record<string, Bi> = {
  not_registered: { ar: "غير مسجلة", en: "Not registered" },
  registered_local: { ar: "مسجلة محليًا (فلسطين)", en: "Registered locally (Palestine)" },
  registered_foreign: { ar: "مسجلة خارج فلسطين", en: "Registered abroad" },
};

export const ASK_TYPE_LABELS: Record<string, Bi> = {
  equity: { ar: "بمالكية (استثمار)", en: "Equity" },
  non_equity: { ar: "بلا ملكية (منح/جوائز)", en: "Non-equity" },
  any: { ar: "أي نوع", en: "Any type" },
};

export const PAYMENT_METHOD_LABELS: Record<string, Bi> = {
  bank_transfer: { ar: "حوالة مصرفية", en: "Bank transfer" },
  paypal: { ar: "PayPal", en: "PayPal" },
  wise: { ar: "Wise", en: "Wise" },
  other: { ar: "طريقة أخرى", en: "Other" },
};

export const LANG_LABELS: Record<string, Bi> = {
  ar: { ar: "العربية", en: "Arabic" },
  en: { ar: "الإنجليزية", en: "English" },
};

export const JUDGMENT_LABELS: Record<Judgment, Bi> = {
  ELIGIBLE: { ar: "مؤهل", en: "Eligible" },
  NOT_ELIGIBLE: { ar: "غير مؤهل", en: "Not eligible" },
  UNCERTAIN: { ar: "غير محسوم", en: "Uncertain" },
};

export const OPP_TYPE_LABELS: Record<string, Bi> = {
  grant: { ar: "منحة", en: "Grant" },
  accelerator: { ar: "مسار تسريع", en: "Accelerator" },
  incubator: { ar: "حاضنة", en: "Incubator" },
  competition: { ar: "مسابقة", en: "Competition" },
  fellowship: { ar: "زمالة", en: "Fellowship" },
  loan: { ar: "قرض", en: "Loan" },
};

export const GEO_LABELS: Record<string, Bi> = {
  local: { ar: "محلية", en: "Local" },
  regional: { ar: "إقليمية", en: "Regional" },
  international: { ar: "دولية", en: "International" },
};

export const DOC_STATUS_LABELS: Record<string, Bi> = {
  available: { ar: "متوفر", en: "Available" },
  missing: { ar: "ناقص", en: "Missing" },
  expired: { ar: "منتهي الصلاحية", en: "Expired" },
};

export const FIELD_LABELS: Record<string, Bi> = {
  "company.name": { ar: "اسم الشركة", en: "Company name" },
  "company.sectors": { ar: "القطاعات", en: "Sectors" },
  "company.stage": { ar: "المرحلة", en: "Stage" },
  "company.registrationCountry": { ar: "بلد التسجيل", en: "Registration country" },
  "company.legalStatus": { ar: "الوضع القانوني", en: "Legal status" },
  "company.ageMonths": { ar: "عمر الشركة", en: "Company age" },
  "company.teamSize": { ar: "حجم الفريق", en: "Team size" },
  "company.womenLed": { ar: "قيادة نسائية", en: "Women-led" },
  "company.monthlyRevenueUSD": { ar: "الإيراد الشهري", en: "Monthly revenue" },
  "company.tractionUsers": { ar: "المستخدمون", en: "Users / traction" },
  "company.askAmountUSD": { ar: "المبلغ المطلوب", en: "Funding ask" },
  "company.askType": { ar: "نوع التمويل المطلوب", en: "Funding type" },
  "company.languages": { ar: "لغات الفريق", en: "Team languages" },
  "company.requiredDocs": { ar: "المستندات المتوفرة", en: "Available documents" },
  "founder.region": { ar: "إقامة المؤسس (الأساسي)", en: "Founder residence (primary)" },
  "founder.nationality": { ar: "جنسية المؤسس (الأساسي)", en: "Founder nationality (primary)" },
  "founder.hasBankAccount": { ar: "حساب مصرفي", en: "Bank account" },
  "founder.paymentMethods": { ar: "طرق استلام التمويل", en: "Payout methods" },
};

/** تسمية من خريطة ثنائية اللغة — القيمة غير المعروفة تُعاد كما هي (حتمية). */
export function labelOf(map: Record<string, Bi>, key: string, lang: "ar" | "en"): string {
  const v = map[key];
  return v ? v[lang] : key;
}

/** تنسيق قيمة حقل للعرض (كل رقم مالي بعملة صريحة — §15). */
export function formatFieldValue(field: string, value: unknown, lang: "ar" | "en"): string {
  if (value === null || value === undefined) return lang === "ar" ? "غير مذكور" : "Not specified";
  if (Array.isArray(value)) {
    if (value.length === 0) return lang === "ar" ? "غير مذكور" : "Not specified";
    return value
      .map((v) => formatFieldValue(field, v, lang))
      .join(lang === "ar" ? "، " : ", ");
  }
  const num = (n: number): string =>
    Number.isFinite(n) ? new Intl.NumberFormat(lang === "ar" ? "ar" : "en").format(n) : String(n);
  switch (field) {
    case "company.sectors":
      return labelOf(SECTOR_LABELS, String(value), lang);
    case "company.stage":
      return labelOf(STAGE_LABELS, String(value), lang);
    case "founder.region":
      return labelOf(REGION_LABELS, String(value), lang);
    case "company.registrationCountry":
    case "founder.nationality":
      return labelOf(COUNTRY_LABELS, String(value), lang);
    case "company.legalStatus":
      return labelOf(LEGAL_STATUS_LABELS, String(value), lang);
    case "company.askType":
      return labelOf(ASK_TYPE_LABELS, String(value), lang);
    case "founder.paymentMethods":
      return labelOf(PAYMENT_METHOD_LABELS, String(value), lang);
    case "company.languages":
      return labelOf(LANG_LABELS, String(value), lang);
    case "company.askAmountUSD":
    case "company.monthlyRevenueUSD":
      return formatMoney(Number(value), "USD", lang);
    case "company.ageMonths":
      return typeof value === "number" || typeof value === "string"
        ? `${num(Number(value))} ${lang === "ar" ? "شهرًا" : "months"}`
        : String(value);
    case "company.teamSize":
      return typeof value === "number" || typeof value === "string"
        ? `${num(Number(value))} ${lang === "ar" ? "شخصًا" : "people"}`
        : String(value);
    case "company.tractionUsers":
      return typeof value === "number" || typeof value === "string"
        ? `${num(Number(value))} ${lang === "ar" ? "مستخدمًا" : "users"}`
        : String(value);
    default:
      break;
  }
  if (typeof value === "boolean") {
    return lang === "ar" ? (value ? "نعم" : "لا") : value ? "Yes" : "No";
  }
  if (typeof value === "number") return num(value);
  return String(value);
}

// —————————————————————————————— مكونات عرض مشتركة ——————————————————————————————

const JUDGMENT_BADGE_STYLES: Record<Judgment, string> = {
  ELIGIBLE:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  NOT_ELIGIBLE:
    "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300",
  UNCERTAIN:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300",
};

/** شارة الحكم الثلاثي: أخضر/أحمر/كهرماني (§15). */
export function JudgmentBadge({ judgment, className }: { judgment: Judgment; className?: string }) {
  const { lang } = useI18n();
  const Icon: LucideIcon =
    judgment === "ELIGIBLE" ? CheckCircle2 : judgment === "NOT_ELIGIBLE" ? XCircle : HelpCircle;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        JUDGMENT_BADGE_STYLES[judgment],
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{labelOf(JUDGMENT_LABELS, judgment, lang)}</span>
    </span>
  );
}

/** شريط الملاءمة (0..100) بلون الحكم — div خام لأنه عنصر عرض لا تفاعل. */
export function ScoreBar({
  total,
  judgment,
  label,
}: {
  total: number | null;
  judgment?: Judgment | null;
  label?: string;
}) {
  const { lang } = useI18n();
  const pct = total === null ? 0 : Math.max(0, Math.min(100, Math.round(total)));
  const bar =
    judgment === "ELIGIBLE"
      ? "bg-emerald-600"
      : judgment === "NOT_ELIGIBLE"
        ? "bg-rose-600"
        : judgment === "UNCERTAIN"
          ? "bg-amber-500"
          : "bg-primary";
  return (
    <div className="flex w-full flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label ?? (lang === "ar" ? "الملاءمة" : "Fit score")}</span>
        <span className="font-semibold tabular-nums">
          {total === null ? "—" : `${pct}/100`}
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={total === null ? undefined : pct}
        aria-label={label ?? (lang === "ar" ? "درجة الملاءمة" : "Fit score")}
      >
        <div
          className={cn("h-full rounded-full transition-all duration-500", bar)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** بطاقة إحصاء مصغّرة. */
export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "emerald" | "amber" | "rose";
}) {
  const toneClass = {
    default: "bg-muted text-muted-foreground",
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    rose: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  }[tone];
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", toneClass)}>
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-xl font-bold tabular-nums leading-tight">{value}</span>
          <span className="truncate text-xs text-muted-foreground">{label}</span>
          {hint ? <span className="truncate text-[11px] text-muted-foreground/80">{hint}</span> : null}
        </div>
      </div>
    </Card>
  );
}

/** شريط تمرير مخصص للقوائم الطويلة (قاعدة UI العامة). */
export const SCROLL_TW =
  "overflow-y-auto [scrollbar-width:thin] [scrollbar-color:var(--muted-foreground)_transparent] " +
  "[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent " +
  "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/25 " +
  "hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/40";

/** سهم منطقي يتبع اتجاه القراءة (RTL logic-aware). */
export function DirArrow({ dir, className }: { dir: "rtl" | "ltr"; className?: string }) {
  const Icon = dir === "rtl" ? ArrowLeft : ArrowRight;
  return <Icon className={cn("size-4 shrink-0", className)} aria-hidden="true" />;
}

// —————————————————————————————— منطق نموذج التحرير ——————————————————————————————

interface FounderDraft {
  name: string;
  region: string;
  nationality: string;
  isPrimary: boolean;
}

interface ProfileDraft {
  name: string;
  sectors: string[];
  stage: string;
  registrationCountry: string;
  legalStatus: string;
  askAmountUSD: string;
  askType: string;
  paymentMethods: string[];
  hasBankAccount: boolean | null;
  teamSize: string;
  monthlyRevenueUSD: string;
  tractionUsers: string;
  ageMonths: string;
  womenLed: boolean | null;
  languages: string[];
  founders: FounderDraft[];
}

interface SaveField {
  field: string;
  value: unknown;
}

function storedValue(p: ProfileData, key: string): unknown {
  const f = p.fields.find((x) => x.field === key);
  return f && f.value !== null && f.value !== undefined ? f.value : null;
}

function storedBool(p: ProfileData, key: string): boolean | null {
  const v = storedValue(p, key);
  return typeof v === "boolean" ? v : null;
}

function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function asNumberString(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return v;
  return "";
}

/** بناء المسودة من الملف — إقامة/جنسية الأساسي تسقطان إلى حقلي الملف عند غياب سجل المؤسس. */
function buildDraft(p: ProfileData): ProfileDraft {
  const rows: FounderDraft[] = p.founders.map((f) => ({
    name: f.name ?? "",
    region: f.region ?? "",
    nationality: f.nationality ?? "",
    isPrimary: f.isPrimary,
  }));
  const primaryIdx = rows.findIndex((r) => r.isPrimary);
  if (primaryIdx >= 0) {
    rows[primaryIdx] = {
      ...rows[primaryIdx],
      region: rows[primaryIdx].region || asString(storedValue(p, "founder.region")),
      nationality: rows[primaryIdx].nationality || asString(storedValue(p, "founder.nationality")),
    };
  }
  return {
    name: asString(storedValue(p, "company.name")),
    sectors: asStringArray(storedValue(p, "company.sectors")),
    stage: asString(storedValue(p, "company.stage")),
    registrationCountry: asString(storedValue(p, "company.registrationCountry")),
    legalStatus: asString(storedValue(p, "company.legalStatus")),
    askAmountUSD: asNumberString(storedValue(p, "company.askAmountUSD")),
    askType: asString(storedValue(p, "company.askType")),
    paymentMethods: asStringArray(storedValue(p, "founder.paymentMethods")),
    hasBankAccount: storedBool(p, "founder.hasBankAccount"),
    teamSize: asNumberString(storedValue(p, "company.teamSize")),
    monthlyRevenueUSD: asNumberString(storedValue(p, "company.monthlyRevenueUSD")),
    tractionUsers: asNumberString(storedValue(p, "company.tractionUsers")),
    ageMonths: asNumberString(storedValue(p, "company.ageMonths")),
    womenLed: storedBool(p, "company.womenLed"),
    languages: asStringArray(storedValue(p, "company.languages")),
    founders: rows,
  };
}

function primaryFounder(d: ProfileDraft): FounderDraft | undefined {
  return d.founders.find((f) => f.isPrimary) ?? d.founders[0];
}

function scalarEqual(a: unknown, b: unknown): boolean {
  const aEmpty = a === null || a === undefined;
  const bEmpty = b === null || b === undefined;
  if (aEmpty || bEmpty) return aEmpty && bEmpty;
  return String(a) === String(b);
}

function arrayEqual(a: unknown, b: unknown): boolean {
  const sa = Array.isArray(a) ? a.map(String) : [];
  const sb = Array.isArray(b) ? b.map(String) : [];
  if (sa.length !== sb.length) return false;
  const x = [...sa].sort();
  const y = [...sb].sort();
  return x.every((v, i) => v === y[i]);
}

/** «مقارنة، إما رقم صالح أو null» — "invalid" للمدخل الرقمي الفاسد. */
function parseLoose(s: string): number | null | "invalid" {
  const v = s.trim();
  if (v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return n;
}

function isIntField(field: string): boolean {
  return (
    field === "company.teamSize" ||
    field === "company.tractionUsers" ||
    field === "company.ageMonths"
  );
}

/** قائمة فارغة = «غير مذكور» (null) — قيمة مفردة يقبلها مخطط الخادم. */
function normList(v: string[]): unknown {
  return v.length === 0 ? null : [...v];
}

/** الحقول المتغيرة فقط (payload PUT /profile) + كشف أول مدخل رقمي فاسد. */
function diffDraftToFields(
  p: ProfileData,
  d: ProfileDraft,
): { fields: SaveField[]; invalidField: string | null } {
  const fields: SaveField[] = [];
  let invalidField: string | null = null;
  const push = (field: string, next: unknown): void => {
    if (next === "invalid") {
      if (invalidField === null) invalidField = field;
      return;
    }
    const prev = storedValue(p, field);
    const changed = Array.isArray(next) || Array.isArray(prev)
      ? !arrayEqual(next, prev)
      : !scalarEqual(next, prev);
    if (changed) fields.push({ field, value: next });
  };

  push("company.name", d.name.trim() === "" ? null : d.name.trim());
  push("company.sectors", normList(d.sectors));
  push("company.stage", d.stage === "" ? null : d.stage);
  push("company.registrationCountry", d.registrationCountry === "" ? null : d.registrationCountry);
  push("company.legalStatus", d.legalStatus === "" ? null : d.legalStatus);
  push("company.askAmountUSD", parseLoose(d.askAmountUSD));
  push("company.askType", d.askType === "" ? null : d.askType);
  push("founder.paymentMethods", normList(d.paymentMethods));
  push("founder.hasBankAccount", d.hasBankAccount);
  push("company.teamSize", parseLoose(d.teamSize));
  push("company.monthlyRevenueUSD", parseLoose(d.monthlyRevenueUSD));
  push("company.tractionUsers", parseLoose(d.tractionUsers));
  push("company.ageMonths", parseLoose(d.ageMonths));
  push("company.womenLed", d.womenLed);
  push("company.languages", normList(d.languages));

  const primary = primaryFounder(d);
  if (primary) {
    push("founder.region", primary.region === "" ? null : primary.region);
    push("founder.nationality", primary.nationality === "" ? null : primary.nationality);
  }
  return { fields, invalidField };
}

/** Any founder-row change must be persisted because the eligibility engine reads founder records first. */
function foundersChanged(p: ProfileData, d: ProfileDraft): boolean {
  if (d.founders.length !== p.founders.length) return true;
  const primaryIdxD = d.founders.findIndex((f) => f.isPrimary);
  const primaryIdxP = p.founders.findIndex((f) => f.isPrimary);
  if (primaryIdxD !== primaryIdxP) return true;
  return d.founders.some((row, i) => {
    const orig = p.founders[i];
    if (!orig) return true;
    return row.name.trim() !== (orig.name ?? "") ||
      row.region !== (orig.region ?? "") ||
      row.nationality !== (orig.nationality ?? "") ||
      row.isPrimary !== orig.isPrimary;
  });
}

/** قراءة params.whatIf بأمان (معلمات التنقل غير موثوقة). */
export function readWhatIfParams(params: Record<string, unknown> | undefined): WhatIfTransferField[] {
  const raw = params?.whatIf;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const fields = (raw as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return [];
  return fields.filter(
    (f): f is WhatIfTransferField =>
      !!f && typeof f === "object" && typeof (f as { field?: unknown }).field === "string",
  );
}

/** تطبيق قيم المحاكي على مسودة النموذج — يعيد عدد الحقول المطبَّقة. */
function applyWhatIfToDraft(d: ProfileDraft, transfer: WhatIfTransferField[]): number {
  let applied = 0;
  for (const tf of transfer) {
    switch (tf.field) {
      case "company.registrationCountry":
        d.registrationCountry = typeof tf.value === "string" ? tf.value : "";
        applied++;
        break;
      case "company.legalStatus":
        d.legalStatus = typeof tf.value === "string" ? tf.value : "";
        applied++;
        break;
      case "company.stage":
        d.stage = typeof tf.value === "string" ? tf.value : "";
        applied++;
        break;
      case "company.askAmountUSD":
        d.askAmountUSD =
          typeof tf.value === "number" && Number.isFinite(tf.value)
            ? String(tf.value)
            : typeof tf.value === "string"
              ? tf.value
              : "";
        applied++;
        break;
      case "company.sectors":
        d.sectors = asStringArray(tf.value);
        applied++;
        break;
      case "founder.region": {
        const region = typeof tf.value === "string" ? tf.value : "";
        const primary = primaryFounder(d);
        if (primary) primary.region = region;
        applied++;
        break;
      }
      default:
        break;
    }
  }
  return applied;
}

function tabForWhatIf(transfer: WhatIfTransferField[]): string {
  const keys = new Set(transfer.map((f) => f.field));
  if (keys.has("company.askAmountUSD") && keys.size === 1) return "funding";
  if (keys.has("company.sectors") || keys.has("company.stage")) return "basic";
  return "geo";
}

// —————————————————————————————— أدوات عرض صغيرة ——————————————————————————————

export function FieldShell({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function SelectField({
  id,
  value,
  placeholder,
  options,
  unsetLabel,
  onChange,
}: {
  id: string;
  value: string;
  placeholder: string;
  options: Array<{ key: string; label: string }>;
  unsetLabel?: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value === "" ? "unset" : value} onValueChange={(v) => onChange(v === "unset" ? "" : v)}>
      <SelectTrigger id={id} className="h-11 w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {unsetLabel ? <SelectItem value="unset">{unsetLabel}</SelectItem> : null}
        {options.map((o) => (
          <SelectItem key={o.key} value={o.key}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function CheckGrid({
  idPrefix,
  options,
  values,
  onChange,
}: {
  idPrefix: string;
  options: Array<{ key: string; label: string }>;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {options.map((o) => {
        const checked = values.includes(o.key);
        const id = `${idPrefix}-${o.key}`;
        return (
          <div
            key={o.key}
            className={cn(
              "flex min-h-11 items-center gap-2 rounded-md border p-2.5 transition-colors",
              checked
                ? "border-primary/50 bg-primary/5"
                : "border-input hover:bg-accent/50",
            )}
          >
            <Checkbox
              id={id}
              checked={checked}
              onCheckedChange={(c) =>
                onChange(c === true ? [...values, o.key] : values.filter((v) => v !== o.key))
              }
            />
            <Label htmlFor={id} className="cursor-pointer text-sm font-normal leading-snug">
              {o.label}
            </Label>
          </div>
        );
      })}
    </div>
  );
}

function BoolField({
  id,
  label,
  value,
  allowUnset,
  resetLabel,
  onChange,
}: {
  id: string;
  label: string;
  value: boolean | null;
  allowUnset: boolean;
  resetLabel: string;
  onChange: (v: boolean | null) => void;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-md border p-3">
      <Label htmlFor={id} className="cursor-pointer text-sm font-medium">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        {value !== null && allowUnset ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title={resetLabel}
            aria-label={resetLabel}
            onClick={() => onChange(null)}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
        <Switch id={id} checked={value === true} onCheckedChange={(c) => onChange(c === true)} />
      </div>
    </div>
  );
}

// —————————————————————————————— الشاشة ——————————————————————————————

/** الحقول المعروضة مجموعات — ترتيب دلالي (18 مفتاحًا من PROFILE_FIELD_KEYS). */
const DISPLAY_SECTIONS: Array<{ key: string; title: Bi; icon: LucideIcon; fields: string[] }> = [
  {
    key: "basic",
    title: { ar: "الأساسية", en: "Basics" },
    icon: Building2,
    fields: ["company.name", "company.sectors", "company.stage"],
  },
  {
    key: "geo",
    title: { ar: "الجغرافيا والقانونية", en: "Geography & Legal" },
    icon: MapPin,
    fields: [
      "founder.region",
      "founder.nationality",
      "company.registrationCountry",
      "company.legalStatus",
    ],
  },
  {
    key: "funding",
    title: { ar: "التمويل", en: "Funding" },
    icon: Wallet,
    fields: [
      "company.askAmountUSD",
      "company.askType",
      "founder.paymentMethods",
      "founder.hasBankAccount",
    ],
  },
  {
    key: "performance",
    title: { ar: "الأداء", en: "Performance" },
    icon: TrendingUp,
    fields: [
      "company.ageMonths",
      "company.teamSize",
      "company.monthlyRevenueUSD",
      "company.tractionUsers",
      "company.womenLed",
      "company.languages",
    ],
  },
  {
    key: "docs",
    title: { ar: "المستندات", en: "Documents" },
    icon: FileStack,
    fields: ["company.requiredDocs"],
  },
];

const TAB_FOR_FIELD: Record<string, string> = {};
for (const s of DISPLAY_SECTIONS) {
  for (const f of s.fields) TAB_FOR_FIELD[f] = s.key === "docs" ? "documents" : s.key;
}

const TOTAL_KNOWN_FIELDS = PROFILE_FIELD_KEYS.length;

export default function ProfileView({ onNavigate, params }: ViewProps) {
  const { t, lang, dir } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string } | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editTab, setEditTab] = useState("basic");
  const [saving, setSaving] = useState(false);
  const whatIfAppliedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // §15: الشاشة تجلب /auth/me نفسها عند أول render (المنسّق يمنع الوصول)
      await api.get<{ user: { role: string } }>("/auth/me");
      const data = await api.get<{ profile: ProfileData }>("/profile");
      setProfile(data.profile);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError({ message });
      setProfile(null);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // تطبيق قيم المحاكي (params.whatIf من WhatIfView) مرة واحدة بعد جلب الملف —
  // يفتح نموذج التحرير معبأً بقيم المحاكاة للمراجعة قبل الحفظ.
  useEffect(() => {
    if (whatIfAppliedRef.current) return;
    const transfer = readWhatIfParams(params);
    if (transfer.length === 0) return;
    if (loading || !profile || editOpen) return; // انتظر اكتمال التحميل
    whatIfAppliedRef.current = true;
    const d = buildDraft(profile);
    const applied = applyWhatIfToDraft(d, transfer);
    if (applied === 0) return;
    setDraft(d);
    setEditTab(tabForWhatIf(transfer));
    setEditOpen(true);
    toast.info(
      t(
        "قُلِبت قيم المحاكاة إلى نموذج الملف — راجعها ثم احفظ",
        "Simulation values were carried into the profile form — review then save",
      ),
    );
  }, [params, loading, profile, editOpen, t]);

  const openEdit = useCallback(
    (tab: string) => {
      if (!profile) return;
      setDraft(buildDraft(profile));
      setEditTab(tab);
      setEditOpen(true);
    },
    [profile],
  );

  // ——— إحصاءات ———
  const stats = (() => {
    if (!profile) return null;
    const present = (key: string): StoredProfileField | undefined => {
      const f = profile.fields.find((x) => x.field === key);
      if (!f) return undefined;
      const v = f.value;
      if (v === null || v === undefined) return undefined;
      if (Array.isArray(v) && v.length === 0) return undefined;
      return f;
    };
    const documented = PROFILE_FIELD_KEYS.filter((k) => present(k)).length;
    const deckSourced = PROFILE_FIELD_KEYS.filter((k) => present(k)?.source === "deck").length;
    const availableDocs = profile.documents.filter((d) => d.status === "available").length;
    return {
      documented,
      deckSourced,
      missing: TOTAL_KNOWN_FIELDS - documented,
      founders: profile.founders.length,
      availableDocs,
      totalDocs: profile.documents.length,
      present,
    };
  })();

  const diffPreview = (() => {
    if (!profile || !draft) return null;
    return diffDraftToFields(profile, draft);
  })();

  const saveProfile = useCallback(async () => {
    if (!profile || !draft) return;
    const { fields, invalidField } = diffDraftToFields(profile, draft);
    if (invalidField) {
      const label = labelOf(FIELD_LABELS, invalidField, lang);
      toast.error(
        t(
          `أدخل رقمًا صحيحًا غير سالب في «${label}»`,
          `Enter a valid non-negative number in “${label}”`,
        ),
      );
      return;
    }
    const hasFounderChanges = foundersChanged(profile, draft);
    if (fields.length === 0 && !hasFounderChanges) {
      toast.info(t("لا توجد تغييرات للحفظ", "No changes to save"));
      setEditOpen(false);
      return;
    }
    setSaving(true);
    try {
      const withSource = (fs: SaveField[]) => fs.map((f) => ({ ...f, source: "manual" as const }));
      const payload: { fields: Array<SaveField & { source: "manual" }>; founders?: Array<{ name: string | null; region: string | null; nationality: string | null; isPrimary: boolean }> } = {
        fields: withSource(fields),
      };
      if (hasFounderChanges) {
        payload.founders = draft.founders.map((founder) => ({
          name: founder.name.trim() || null,
          region: founder.region || null,
          nationality: founder.nationality || null,
          isPrimary: founder.isPrimary,
        }));
      }
      const res = await api.put<{ profile: ProfileData }>("/profile", payload);
      setProfile(res.profile);
      setEditOpen(false);
      toast.success(t("حُفظ الملف — حدّث المطابقات", "Profile saved — refresh your matches"), {
        action: {
          label: t("عرض مطابقاتي", "View matches"),
          onClick: () => onNavigate("matches"),
        },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [profile, draft, lang, t, onNavigate]);

  // —————————————————————————————— عناصر العرض ——————————————————————————————

  const toaster = (
    <Toaster richColors position="top-center" dir={dir} closeButton />
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        {toaster}
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (error || !profile || !stats) {
    return (
      <div className="flex flex-col gap-6">
        {toaster}
        <Card className="p-6" role="alert">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-300">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </span>
            <div className="flex-1">
              <CardTitle className="text-base">{t("تعذّر تحميل ملف الشركة", "Failed to load company profile")}</CardTitle>
              <CardDescription className="mt-1 text-sm leading-relaxed">
                {error?.message ?? t("خطأ غير متوقع", "Unexpected error")}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button className="h-11" onClick={() => void load()}>
                <RefreshCw className="me-2 size-4" aria-hidden="true" />
                {t("إعادة المحاولة", "Retry")}
              </Button>
              <Button
                variant="outline"
                className="h-11"
                onClick={() => onNavigate("home", { openAuth: true })}
              >
                <LogIn className="me-2 size-4" aria-hidden="true" />
                {t("تسجيل الدخول", "Sign in")}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const sectorOptions = SECTOR_KEYS.map((k) => ({ key: k, label: labelOf(SECTOR_LABELS, k, lang) }));
  const stageOptions = STAGE_KEYS.map((k) => ({ key: k, label: labelOf(STAGE_LABELS, k, lang) }));
  const regionOptions = REGION_VALUES.map((k) => ({ key: k, label: labelOf(REGION_LABELS, k, lang) }));
  const countryOptions = [
    ...COUNTRY_KEYS.map((k) => ({ key: k, label: labelOf(COUNTRY_LABELS, k, lang) })),
    { key: "none", label: t("غير مسجلة (لا شركة بعد)", "Not registered (no company yet)") },
  ];
  const legalOptions = LEGAL_STATUS_VALUES.map((k) => ({
    key: k,
    label: labelOf(LEGAL_STATUS_LABELS, k, lang),
  }));
  const askTypeOptions = (["equity", "non_equity", "any"] as const).map((k) => ({
    key: k,
    label: labelOf(ASK_TYPE_LABELS, k, lang),
  }));
  const paymentOptions = (["bank_transfer", "paypal", "wise", "other"] as const).map((k) => ({
    key: k,
    label: labelOf(PAYMENT_METHOD_LABELS, k, lang),
  }));
  const langOptions = (["ar", "en"] as const).map((k) => ({
    key: k,
    label: labelOf(LANG_LABELS, k, lang),
  }));
  const unsetLabel = t("غير محدد", "Unspecified");

  const primary = draft ? primaryFounder(draft) : undefined;

  const updateDraft = (patch: Partial<ProfileDraft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  };

  const updatePrimaryFounder = (patch: Partial<FounderDraft>) => {
    setDraft((d) => {
      if (!d) return d;
      const idx = d.founders.findIndex((f) => f.isPrimary);
      const target = idx >= 0 ? idx : 0;
      if (!d.founders[target]) return d;
      const founders = d.founders.map((f, i) => (i === target ? { ...f, ...patch } : f));
      return { ...d, founders };
    });
  };

  const makePrimary = (index: number, on: boolean) => {
    setDraft((d) => {
      if (!d) return d;
      if (!on) {
        const isOnly = d.founders[index]?.isPrimary && d.founders.filter((f) => f.isPrimary).length === 1;
        if (isOnly) {
          toast.info(
            t("يجب أن يبقى مؤسس أساسي واحد على الأقل", "At least one primary founder is required"),
          );
          return d;
        }
        const founders = d.founders.map((f, i) => (i === index ? { ...f, isPrimary: false } : f));
        return { ...d, founders };
      }
      const founders = d.founders.map((f, i) => ({ ...f, isPrimary: i === index }));
      return { ...d, founders };
    });
  };

  const removeFounder = (index: number) => {
    setDraft((d) => {
      if (!d) return d;
      if (d.founders.length <= 1) {
        toast.info(t("لا بد من مؤسس واحد على الأقل", "At least one founder is required"));
        return d;
      }
      const founders = d.founders.filter((_, i) => i !== index);
      if (!founders.some((f) => f.isPrimary) && founders.length > 0) founders[0].isPrimary = true;
      return { ...d, founders };
    });
  };

  const addFounder = () => {
    setDraft((d) => {
      if (!d) return d;
      if (d.founders.length >= 6) {
        toast.info(t("الحد الأقصى 6 مؤسسين", "Maximum of 6 founders"));
        return d;
      }
      return { ...d, founders: [...d.founders, { name: "", region: "", nationality: "", isPrimary: false }] };
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {toaster}

      {/* بطاقة التلميح الإلزامية */}
      <Card className="border-amber-300/70 bg-amber-50/60 p-4 dark:border-amber-700/60 dark:bg-amber-950/40">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
          <p className="text-sm leading-relaxed text-amber-900 dark:text-amber-200">
            {t(
              "الحقول القادمة من عرضك تُحدَّث فقط عبر تأكيد الاستخراج — المصدر يبقى موثقًا",
              "Fields sourced from your pitch deck update only via extraction confirmation — the source stays documented",
            )}
          </p>
        </div>
      </Card>

      {/* الترويسة */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight">{t("ملف الشركة", "Company Profile")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "كل حقل موثَّق بمصدره — يدوي أو من عرضك التقديمي",
              "Every field is source-documented — manual or from your pitch deck",
            )}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("آخر تحديث", "Last updated")}: {formatDate(profile.updatedAt, lang)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button className="h-11" onClick={() => openEdit("basic")}>
            <PencilLine className="me-2 size-4" aria-hidden="true" />
            {t("تحرير الملف", "Edit profile")}
          </Button>
          <Button variant="outline" className="h-11" onClick={() => onNavigate("matches")}>
            {t("عرض مطابقاتي", "View my matches")}
          </Button>
        </div>
      </header>

      {/* الإحصاءات */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={ListChecks}
          label={t("حقول موثقة", "Documented fields")}
          value={`${stats.documented}/${TOTAL_KNOWN_FIELDS}`}
          tone="emerald"
        />
        <StatCard
          icon={BookOpen}
          label={t("حقول من العرض", "Deck-sourced fields")}
          value={String(stats.deckSourced)}
          hint={t("باقتباس وصفحة", "With quote and page")}
        />
        <StatCard
          icon={HelpCircle}
          label={t("حقول غير مذكورة", "Unspecified fields")}
          value={String(stats.missing)}
          tone={stats.missing > 0 ? "amber" : "default"}
        />
        <StatCard icon={Users} label={t("المؤسسون", "Founders")} value={String(stats.founders)} />
      </div>

      {/* بطاقات الحقول مجموعات */}
      {DISPLAY_SECTIONS.map((section) => {
        const documentedInSection = section.fields.filter((f) => stats.present(f)).length;
        return (
          <section key={section.key} aria-label={section.title[lang]}>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <section.icon className="size-4 text-primary" aria-hidden="true" />
                  {section.title[lang]}
                  <Badge variant="secondary" className="ms-auto tabular-nums">
                    {documentedInSection}/{section.fields.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {section.fields.map((fieldKey) => {
                  const stored = stats.present(fieldKey);
                  const label = labelOf(FIELD_LABELS, fieldKey, lang);
                  const formatted = formatFieldValue(fieldKey, stored?.value ?? null, lang);
                  const targetTab = TAB_FOR_FIELD[fieldKey];
                  return (
                    <div
                      key={fieldKey}
                      className={cn(
                        "flex min-h-16 flex-col justify-between gap-2 rounded-lg border p-3",
                        stored ? "bg-card" : "border-dashed bg-muted/30",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">{label}</span>
                        {stored ? <SourceChip stored={stored} /> : null}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "min-w-0 text-sm font-medium leading-snug",
                            stored ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {formatted}
                        </span>
                        {!stored ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-11 shrink-0 gap-1 px-2"
                            aria-label={t(`إضافة ${label}`, `Add ${label}`)}
                            onClick={() => {
                              if (targetTab === "documents") onNavigate("documents");
                              else openEdit(targetTab);
                            }}
                          >
                            <Plus className="size-4" aria-hidden="true" />
                            <span className="hidden sm:inline">{t("إضافة", "Add")}</span>
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </section>
        );
      })}

      {/* المؤسسون */}
      <section aria-label={t("المؤسسون", "Founders")}>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4 text-primary" aria-hidden="true" />
              {t("المؤسسون", "Founders")}
              <Badge variant="secondary" className="ms-auto tabular-nums">
                {profile.founders.length}
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              {t(
                "إقامة المؤسس الأساسي وجنسيته تُحفظان كحقلي ملف — تُقرآن من سجل المؤسسين أولًا عند وجوده",
                "The primary founder's residence and nationality save as profile fields — read from the founder record first when present",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {profile.founders.map((f) => (
                <div
                  key={f.id}
                  className="flex min-h-11 flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2"
                >
                  <span className="text-sm font-medium">
                    {f.name?.trim() !== "" && f.name ? f.name : t("مؤسس", "Founder")}
                  </span>
                  {f.isPrimary ? (
                    <Badge className="gap-1">
                      <Landmark className="size-3" aria-hidden="true" />
                      {t("أساسي", "Primary")}
                    </Badge>
                  ) : null}
                  {f.region ? (
                    <Badge variant="outline">{labelOf(REGION_LABELS, f.region, lang)}</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      {t("الإقامة غير مذكورة", "Residence unspecified")}
                    </Badge>
                  )}
                  {f.nationality ? (
                    <Badge variant="secondary">{labelOf(COUNTRY_LABELS, f.nationality, lang)}</Badge>
                  ) : null}
                </div>
              ))}
            </div>
            <Button variant="outline" className="h-11 w-fit" onClick={() => openEdit("founders")}>
              <PencilLine className="me-2 size-4" aria-hidden="true" />
              {t("تحرير المؤسسين", "Edit founders")}
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* ملخص المستندات */}
      <section aria-label={t("المستندات", "Documents")}>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileStack className="size-4 text-primary" aria-hidden="true" />
              {t("مستندات الشركة", "Company documents")}
              <Badge variant="secondary" className="ms-auto tabular-nums">
                {stats.availableDocs}/{stats.totalDocs}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {t("متوفر", "Available")}: <span className="font-semibold tabular-nums">{stats.availableDocs}</span>
              {" · "}
              {t("ناقص", "Missing")}:{" "}
              <span className="font-semibold tabular-nums">
                {profile.documents.filter((d) => d.status === "missing").length}
              </span>
              {" · "}
              {t("منتهي", "Expired")}:{" "}
              <span className="font-semibold tabular-nums">
                {profile.documents.filter((d) => d.status === "expired").length}
              </span>
            </p>
            <Button variant="outline" className="h-11" onClick={() => onNavigate("documents")}>
              {t("إدارة المستندات", "Manage documents")}
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* ——— نموذج التحرير (أقسام) ——— */}
      <Dialog
        open={editOpen && draft !== null}
        onOpenChange={(open) => {
          if (!open) setEditOpen(false);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("تحرير ملف الشركة", "Edit company profile")}</DialogTitle>
            <DialogDescription>
              {t(
                "القيم تتغير بمصدر «يدوي» — الحقول القادمة من عرضك تبقى موثقة بمصدرها حتى تأكيد استخراج جديد",
                "Values save with a “manual” source — deck-sourced fields keep their documented source until a new extraction confirmation",
              )}
            </DialogDescription>
          </DialogHeader>

          <Tabs value={editTab} onValueChange={setEditTab} dir={dir} className="mt-2">
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
              <TabsTrigger value="basic" className="min-h-9">{t("أساسية", "Basics")}</TabsTrigger>
              <TabsTrigger value="geo" className="min-h-9">{t("جغرافية وقانونية", "Geo & legal")}</TabsTrigger>
              <TabsTrigger value="funding" className="min-h-9">{t("تمويل", "Funding")}</TabsTrigger>
              <TabsTrigger value="performance" className="min-h-9">{t("أداء", "Performance")}</TabsTrigger>
              <TabsTrigger value="founders" className="min-h-9">{t("مؤسسون", "Founders")}</TabsTrigger>
            </TabsList>

            <div className={cn("mt-4 max-h-[55vh] pr-1", SCROLL_TW)}>
              <TabsContent value="basic" className="mt-0 flex flex-col gap-5">
                <FieldShell label={labelOf(FIELD_LABELS, "company.name", lang)} htmlFor="f-name">
                  <Input
                    id="f-name"
                    className="h-11"
                    value={draft?.name ?? ""}
                    onChange={(e) => updateDraft({ name: e.target.value })}
                    placeholder={t("مثال: شركة الزراعة الذكية", "e.g. Smart Agriculture Co.")}
                  />
                </FieldShell>
                <FieldShell
                  label={labelOf(FIELD_LABELS, "company.sectors", lang)}
                  hint={t("اختر قطاعًا واحدًا أو أكثر", "Select one or more sectors")}
                >
                  <CheckGrid
                    idPrefix="f-sector"
                    options={sectorOptions}
                    values={draft?.sectors ?? []}
                    onChange={(sectors) => updateDraft({ sectors })}
                  />
                </FieldShell>
                <FieldShell label={labelOf(FIELD_LABELS, "company.stage", lang)} htmlFor="f-stage">
                  <SelectField
                    id="f-stage"
                    value={draft?.stage ?? ""}
                    placeholder={t("اختر المرحلة", "Select stage")}
                    options={stageOptions}
                    unsetLabel={unsetLabel}
                    onChange={(stage) => updateDraft({ stage })}
                  />
                </FieldShell>
              </TabsContent>

              <TabsContent value="geo" className="mt-0 flex flex-col gap-5">
                <FieldShell
                  label={labelOf(FIELD_LABELS, "founder.region", lang)}
                  htmlFor="f-region"
                  hint={t("تُطبَّق على المؤسس الأساسي", "Applies to the primary founder")}
                >
                  <SelectField
                    id="f-region"
                    value={primary?.region ?? ""}
                    placeholder={t("اختر الإقامة", "Select residence")}
                    options={regionOptions}
                    unsetLabel={unsetLabel}
                    onChange={(region) => updatePrimaryFounder({ region })}
                  />
                </FieldShell>
                <FieldShell
                  label={labelOf(FIELD_LABELS, "company.registrationCountry", lang)}
                  htmlFor="f-country"
                >
                  <SelectField
                    id="f-country"
                    value={draft?.registrationCountry ?? ""}
                    placeholder={t("اختر بلد التسجيل", "Select registration country")}
                    options={countryOptions}
                    unsetLabel={unsetLabel}
                    onChange={(registrationCountry) => updateDraft({ registrationCountry })}
                  />
                </FieldShell>
                <FieldShell label={labelOf(FIELD_LABELS, "company.legalStatus", lang)} htmlFor="f-legal">
                  <SelectField
                    id="f-legal"
                    value={draft?.legalStatus ?? ""}
                    placeholder={t("اختر الوضع القانوني", "Select legal status")}
                    options={legalOptions}
                    unsetLabel={unsetLabel}
                    onChange={(legalStatus) => updateDraft({ legalStatus })}
                  />
                </FieldShell>
              </TabsContent>

              <TabsContent value="funding" className="mt-0 flex flex-col gap-5">
                <FieldShell
                  label={labelOf(FIELD_LABELS, "company.askAmountUSD", lang)}
                  htmlFor="f-ask"
                  hint={t("بالدولار الأمريكي", "In USD")}
                >
                  <Input
                    id="f-ask"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    className="h-11"
                    value={draft?.askAmountUSD ?? ""}
                    onChange={(e) => updateDraft({ askAmountUSD: e.target.value })}
                    placeholder={t("مثال: 50000", "e.g. 50000")}
                  />
                </FieldShell>
                <FieldShell label={labelOf(FIELD_LABELS, "company.askType", lang)} htmlFor="f-asktype">
                  <SelectField
                    id="f-asktype"
                    value={draft?.askType ?? ""}
                    placeholder={t("اختر نوع التمويل", "Select funding type")}
                    options={askTypeOptions}
                    unsetLabel={unsetLabel}
                    onChange={(askType) => updateDraft({ askType })}
                  />
                </FieldShell>
                <FieldShell
                  label={labelOf(FIELD_LABELS, "founder.paymentMethods", lang)}
                  hint={t("طرق يمكنك بها استلام التمويل — تُذكر كعوائق تنفيذ لا كأهلية", "How you can receive funds — shown as execution notes, not eligibility")}
                >
                  <CheckGrid
                    idPrefix="f-pay"
                    options={paymentOptions}
                    values={draft?.paymentMethods ?? []}
                    onChange={(paymentMethods) => updateDraft({ paymentMethods })}
                  />
                </FieldShell>
                <BoolField
                  id="f-bank"
                  label={labelOf(FIELD_LABELS, "founder.hasBankAccount", lang)}
                  value={draft?.hasBankAccount ?? null}
                  allowUnset={storedBool(profile, "founder.hasBankAccount") === null}
                  resetLabel={t("إعادة إلى غير محدد", "Reset to unspecified")}
                  onChange={(hasBankAccount) => updateDraft({ hasBankAccount })}
                />
              </TabsContent>

              <TabsContent value="performance" className="mt-0 flex flex-col gap-5">
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <FieldShell
                    label={labelOf(FIELD_LABELS, "company.teamSize", lang)}
                    htmlFor="f-team"
                    hint={t("عدد صحيح", "Whole number")}
                  >
                    <Input
                      id="f-team"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      className="h-11"
                      value={draft?.teamSize ?? ""}
                      onChange={(e) => updateDraft({ teamSize: e.target.value })}
                      placeholder="6"
                    />
                  </FieldShell>
                  <FieldShell
                    label={labelOf(FIELD_LABELS, "company.monthlyRevenueUSD", lang)}
                    htmlFor="f-revenue"
                    hint={t("شهريًا بالدولار الأمريكي", "Monthly, in USD")}
                  >
                    <Input
                      id="f-revenue"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      className="h-11"
                      value={draft?.monthlyRevenueUSD ?? ""}
                      onChange={(e) => updateDraft({ monthlyRevenueUSD: e.target.value })}
                      placeholder="3000"
                    />
                  </FieldShell>
                  <FieldShell
                    label={labelOf(FIELD_LABELS, "company.tractionUsers", lang)}
                    htmlFor="f-users"
                    hint={t("عدد صحيح", "Whole number")}
                  >
                    <Input
                      id="f-users"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      className="h-11"
                      value={draft?.tractionUsers ?? ""}
                      onChange={(e) => updateDraft({ tractionUsers: e.target.value })}
                      placeholder="1200"
                    />
                  </FieldShell>
                  <FieldShell
                    label={labelOf(FIELD_LABELS, "company.ageMonths", lang)}
                    htmlFor="f-age"
                    hint={t("بالأشهر — عدد صحيح", "In months — whole number")}
                  >
                    <Input
                      id="f-age"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      className="h-11"
                      value={draft?.ageMonths ?? ""}
                      onChange={(e) => updateDraft({ ageMonths: e.target.value })}
                      placeholder="18"
                    />
                  </FieldShell>
                </div>
                <BoolField
                  id="f-women"
                  label={labelOf(FIELD_LABELS, "company.womenLed", lang)}
                  value={draft?.womenLed ?? null}
                  allowUnset={storedBool(profile, "company.womenLed") === null}
                  resetLabel={t("إعادة إلى غير محدد", "Reset to unspecified")}
                  onChange={(womenLed) => updateDraft({ womenLed })}
                />
                <FieldShell label={labelOf(FIELD_LABELS, "company.languages", lang)}>
                  <CheckGrid
                    idPrefix="f-lang"
                    options={langOptions}
                    values={draft?.languages ?? []}
                    onChange={(languages) => updateDraft({ languages })}
                  />
                </FieldShell>
              </TabsContent>

              <TabsContent value="founders" className="mt-0 flex flex-col gap-4">
                <p className="rounded-md bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
                  {t(
                    "تُحفظ أسماء المؤسسين وإقامتهم وجنسياتهم واختيار المؤسس الأساسي ضمن الملف.",
                    "Founder names, residence, nationality, and the primary-founder selection are saved with the profile.",
                  )}
                </p>
                {draft?.founders.map((row, i) => (
                  <div key={i} className="flex flex-col gap-3 rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-muted-foreground">
                        #{i + 1}
                        {row.isPrimary ? ` · ${t("أساسي", "Primary")}` : ""}
                      </span>
                      <div className="flex items-center gap-2">
                        <div className="flex min-h-11 items-center gap-2">
                          <Label htmlFor={`fnd-primary-${i}`} className="cursor-pointer text-xs">
                            {t("أساسي", "Primary")}
                          </Label>
                          <Switch
                            id={`fnd-primary-${i}`}
                            checked={row.isPrimary}
                            onCheckedChange={(c) => makePrimary(i, c === true)}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11"
                          aria-label={t("إزالة المؤسس", "Remove founder")}
                          onClick={() => removeFounder(i)}
                        >
                          <X className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                    <Input
                      aria-label={t("اسم المؤسس", "Founder name")}
                      className="h-11"
                      value={row.name}
                      onChange={(e) =>
                        setDraft((d) => {
                          if (!d) return d;
                          const founders = d.founders.map((f, j) =>
                            j === i ? { ...f, name: e.target.value } : f,
                          );
                          return { ...d, founders };
                        })
                      }
                      placeholder={t("اسم المؤسس", "Founder name")}
                    />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <SelectField
                        id={`fnd-region-${i}`}
                        value={row.region}
                        placeholder={t("الإقامة", "Residence")}
                        options={regionOptions}
                        unsetLabel={unsetLabel}
                        onChange={(region) =>
                          setDraft((d) => {
                            if (!d) return d;
                            const founders = d.founders.map((f, j) =>
                              j === i ? { ...f, region } : f,
                            );
                            return { ...d, founders };
                          })
                        }
                      />
                      <SelectField
                        id={`fnd-nationality-${i}`}
                        value={row.nationality}
                        placeholder={t("الجنسية", "Nationality")}
                        options={countryOptions}
                        unsetLabel={unsetLabel}
                        onChange={(nationality) =>
                          setDraft((d) => {
                            if (!d) return d;
                            const founders = d.founders.map((f, j) =>
                              j === i ? { ...f, nationality } : f,
                            );
                            return { ...d, founders };
                          })
                        }
                      />
                    </div>
                  </div>
                ))}
                <Button variant="outline" className="h-11 w-fit" onClick={addFounder}>
                  <Plus className="me-2 size-4" aria-hidden="true" />
                  {t("إضافة مؤسس", "Add founder")}
                </Button>
              </TabsContent>
            </div>
          </Tabs>

          <DialogFooter className="mt-4 flex-col gap-2 sm:flex-row sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {diffPreview && diffPreview.fields.length > 0
                ? t(
                    `سيُحفظ ${diffPreview.fields.length} ${
                      diffPreview.fields.length === 1 ? "حقل" : "حقول"
                    } بمصدر يدوي`,
                    `${diffPreview.fields.length} ${
                      diffPreview.fields.length === 1 ? "field" : "fields"
                    } will be saved with a manual source`,
                  )
                : t("لا تغييرات بعد", "No changes yet")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="h-11" onClick={() => setEditOpen(false)} disabled={saving}>
                {t("إلغاء", "Cancel")}
              </Button>
              <Button className="h-11" onClick={() => void saveProfile()} disabled={saving}>
                {saving ? (
                  <Loader2 className="me-2 size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="me-2 size-4" aria-hidden="true" />
                )}
                {t("حفظ الملف", "Save profile")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** شارة المصدر: «مصدر يدوي» أو «من العرض — نسخة V، شريحة N» + tooltip الاقتباس والتأكيد. */
function SourceChip({ stored }: { stored: StoredProfileField }) {
  const { t, lang } = useI18n();
  if (stored.source === "deck") {
    const version = typeof stored.deckVersion === "number" ? stored.deckVersion : null;
    const page = typeof stored.page === "number" ? stored.page : null;
    const text =
      version !== null && page !== null
        ? t(`من العرض — نسخة ${version}، شريحة ${page}`, `From deck — version ${version}, slide ${page}`)
        : t("من العرض", "From deck");
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="cursor-help gap-1 text-[11px]">
            <BookOpen className="size-3" aria-hidden="true" />
            {text}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs whitespace-normal text-start leading-relaxed">
          <p className="mb-1 text-xs font-semibold">
            {t("الاقتباس الحرفي من العرض", "Literal quote from the deck")}
          </p>
          {stored.quote ? (
            <p className="italic opacity-90">{`«${stored.quote}»`}</p>
          ) : (
            <p className="opacity-70">{t("لا اقتباس مسجل", "No quote recorded")}</p>
          )}
          {stored.confirmedAt ? (
            <p className="mt-1 opacity-80">
              {t("تاريخ التأكيد", "Confirmed")}: {formatDate(stored.confirmedAt, lang)}
            </p>
          ) : null}
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="secondary" className="cursor-help gap-1 text-[11px]">
          <PencilLine className="size-3" aria-hidden="true" />
          {t("مصدر يدوي", "Manual")}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs whitespace-normal text-start">
        <p>
          {t("أدخلتَ هذه القيمة يدويًا", "You entered this value manually")}
          {stored.confirmedAt
            ? ` — ${t("تاريخ التأكيد", "Confirmed")}: ${formatDate(stored.confirmedAt, lang)}`
            : ""}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
