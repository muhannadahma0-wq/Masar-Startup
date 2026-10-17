"use client";
/**
 * Masar — T18: لوحة المراجع (AdminView)
 * =============================================================================
 * role REVIEWER/ADMIN فقط (تُتحقق الشاشة نفسها من /auth/me وتعرض EmptyState
 * لغير المراجعين). خمسة تبويبات:
 *  1. «قائمة الانتظار» — لا يوجد مسار قائمة إدارية في العقد (تحقّق فعلي من
 *     src/app/api/v1/opportunities/route.ts: يعرض PUBLISHED فقط للمؤسس،
 *     includeAll غير مدعوم) — لذا تُبنى القائمة من: /admin/duplicates
 *     (الفرص غير المنشورة ببيانات جزئية) + /opportunities?take=100
 *     (المنشورة كاملة) + الفرص المُنشأة داخل الجلسة (كاملة من ردود الإنشاء).
 *     لكل فرصة: الحالة Badge + الجهة + الموعد + عدد الشروط + أزرار الحالة
 *     (submit-review / publish / reject بحوار سبب إلزامي).
 *  2. «إنشاء فرصة (L0)» — نموذج كامل مع شروط ديناميكية (field/op/value
 *     ديناميكي/mandatory/ambiguous/scope/sourceWording/evidence) →
 *     POST /admin/opportunities → toast + تفريغ + إدراج في قائمة الانتظار.
 *  3. «مسودة من رابط» — POST /admin/opportunities/draft-from-url عبر fetch
 *     خام (الوصول إلى error.details عند 422 DRAFT_NEEDS_MANUAL_FIX لعرض
 *     المسودة والاقتباسات والمشكلات) + «تحتاج إكمالًا يدويًا».
 *  4. «تحديث فرصة منشورة» — اختيار PUBLISHED + patch (الموعد/المبلغ/الشروط
 *     الجديدة كاملة) + سبب → POST /admin/opportunities/[id]/update →
 *     toast «أُنشئت نسخة N وأُشعر X مستخدمًا».
 *  5. «التكرارات» — GET /admin/duplicates → أزواج مع similarity وعرض جنبي.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { useI18n, formatDate } from "@/components/app/i18n";
import { EmptyState } from "@/components/app/badges";
import {
  PROFILE_FIELD_KEYS,
  SECTOR_KEYS,
  STAGE_KEYS,
  DOC_TYPE_KEYS,
} from "@/lib/core/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  FilePenLine,
  FilePlus2,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import type { ViewProps } from "@/components/app/types";
import { cn } from "@/lib/utils";

// ————— قواميس محلية —————

const UNSET = "__unset__";

const FIELD_LABELS: Record<string, string> = {
  "company.name": "اسم الشركة",
  "company.sectors": "القطاعات",
  "company.stage": "مرحلة الشركة",
  "company.registrationCountry": "بلد التسجيل",
  "company.legalStatus": "الوضع القانوني",
  "company.ageMonths": "عمر الشركة (شهرًا)",
  "company.teamSize": "حجم الفريق",
  "company.womenLed": "قيادة نسائية",
  "company.monthlyRevenueUSD": "الإيراد الشهري (USD)",
  "company.tractionUsers": "عدد المستخدمين",
  "company.askAmountUSD": "المبلغ المطلوب (USD)",
  "company.askType": "نوع التمويل المطلوب",
  "company.languages": "لغات الفريق",
  "company.requiredDocs": "المستندات المتوفرة",
  "founder.region": "منطقة المؤسس",
  "founder.nationality": "جنسية المؤسس",
  "founder.hasBankAccount": "حساب بنكي",
  "founder.paymentMethods": "طرق استلام التمويل",
};

const DOC_LABELS: Record<string, string> = {
  registration_cert: "شهادة تسجيل الشركة",
  pitch_deck: "العرض التقديمي (Deck)",
  financial_statements: "القوائم المالية",
  founder_id: "هوية المؤسس",
  business_plan: "خطة العمل",
  tax_record: "السجل الضريبي",
  bank_letter: "الخطاب البنكي",
  prototype_demo: "النموذج الأولي / عرض توضيحي",
  letters_of_support: "رسائل الدعم",
};

const SECTOR_LABELS: Record<string, string> = {
  agritech: "تقنية زراعية",
  fintech: "تقنية مالية",
  healthtech: "تقنية صحية",
  edtech: "تقنية تعليمية",
  cleantech: "تقنية نظيفة",
  iot: "إنترنت الأشياء",
  ecommerce: "تجارة إلكترونية",
  logistics: "لوجستيات",
  tourism: "سياحة",
  food: "غذاء",
  manufacturing: "تصنيع",
  software: "برمجيات",
  ai: "ذكاء اصطناعي",
  water: "مياه",
  energy: "طاقة",
  social: "اجتماعي",
  media: "إعلام",
  other: "أخرى",
};

const STAGE_LABELS: Record<string, string> = {
  idea: "فكرة",
  prototype: "نموذج أولي",
  early_revenue: "إيرادات مبكرة",
  scaling: "توسّع",
};

const OPP_TYPE_OPTIONS = [
  { value: "grant", ar: "منحة", en: "Grant" },
  { value: "accelerator", ar: "مسرّعة", en: "Accelerator" },
  { value: "incubator", ar: "حاضنة", en: "Incubator" },
  { value: "competition", ar: "مسابقة", en: "Competition" },
  { value: "fellowship", ar: "زمالة", en: "Fellowship" },
  { value: "loan", ar: "قرض", en: "Loan" },
];

const FUNDING_TYPE_OPTIONS = [
  { value: "equity", ar: "حصص (Equity)", en: "Equity" },
  { value: "non_equity", ar: "غير حصص", en: "Non-equity" },
  { value: "convertible", ar: "قابل للتحويل", en: "Convertible" },
  { value: "mixed", ar: "مختلط", en: "Mixed" },
];

const GEOGRAPHY_OPTIONS = [
  { value: "local", ar: "محلية (فلسطين)", en: "Local" },
  { value: "regional", ar: "إقليمية", en: "Regional" },
  { value: "international", ar: "دولية", en: "International" },
];

const SOURCE_TYPE_OPTIONS = [
  { value: "official", ar: "رسمي (الجهة نفسها)", en: "Official" },
  { value: "trusted_aggregator", ar: "مجمّع موثوق", en: "Trusted aggregator" },
  { value: "other", ar: "آخر", en: "Other" },
];

const CURRENCY_OPTIONS = ["USD", "EUR", "ILS", "JOD", "EGP", "SAR", "AED", "QAR", "KWD", "TRY", "GBP"];

const TZ_OPTIONS = [
  "Asia/Hebron",
  "Asia/Amman",
  "Asia/Riyadh",
  "Asia/Dubai",
  "Africa/Cairo",
  "Europe/London",
  "UTC",
  "America/New_York",
];

const OP_OPTIONS: Array<{ value: string; ar: string; en: string; hint: string }> = [
  { value: "eq", ar: "يساوي", en: "Equals", hint: "قيمة واحدة (نص أو رقم)" },
  { value: "neq", ar: "لا يساوي", en: "Not equals", hint: "قيمة واحدة (نص أو رقم)" },
  { value: "in", ar: "ضمن قائمة", en: "In list", hint: "قيم مفصولة بفواصل" },
  { value: "not_in", ar: "ليس ضمن قائمة", en: "Not in list", hint: "قيم مفصولة بفواصل" },
  { value: "gte", ar: "على الأقل (≥)", en: "At least (≥)", hint: "رقم" },
  { value: "lte", ar: "بحد أقصى (≤)", en: "At most (≤)", hint: "رقم" },
  { value: "between", ar: "بين (مدى)", en: "Between", hint: "رقمان مفصولان بفاصلة: min,max" },
  { value: "contains", ar: "يحتوي", en: "Contains", hint: "نص" },
  { value: "exists", ar: "موجود (أي قيمة)", en: "Exists", hint: "بلا قيمة" },
];

const OPP_STATUS_CONF: Record<string, { ar: string; en: string; cls: string }> = {
  DRAFT: {
    ar: "مسودة",
    en: "Draft",
    cls: "border-border bg-muted text-muted-foreground",
  },
  NEEDS_REVIEW: {
    ar: "بانتظار المراجعة",
    en: "Needs review",
    cls: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  PUBLISHED: {
    ar: "منشورة",
    en: "Published",
    cls: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  REJECTED: {
    ar: "مرفوضة",
    en: "Rejected",
    cls: "border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300",
  },
  ARCHIVED: {
    ar: "مؤرشفة",
    en: "Archived",
    cls: "border-border bg-muted text-muted-foreground",
  },
};

const SCROLL_CLS =
  "max-h-96 overflow-y-auto pe-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border";

// ————— أنواع —————

interface QueueItem {
  id: string;
  title: string;
  orgName: string;
  status: string;
  type: string;
  deadline?: string | null;
  conditionsCount?: number | null;
  /** بيانات جزئية (من كاشف التكرارات) */
  partial?: boolean;
  rejectReason?: string | null;
}

interface PublishedItem {
  id: string;
  title: string;
  orgName: string;
  type: string;
  deadline: string | null;
  status: string;
}

interface DuplicateCandidateLite {
  id: string;
  title: string;
  orgName: string;
  status: string;
  type: string;
  normalizedUrl?: string | null;
}

interface DuplicatePair {
  a: DuplicateCandidateLite;
  b: DuplicateCandidateLite;
  similarity: number;
  sameUrl: boolean;
  labelAr?: string;
}

interface ConditionDraft {
  field: string;
  op: string;
  valueText: string;
  mandatory: boolean;
  ambiguous: boolean;
  scope: string;
  sourceWording: string;
  evidenceUrl: string;
  evidenceQuote: string;
  evidenceVerifiedAt: string;
}

function emptyCondition(): ConditionDraft {
  return {
    field: "founder.region",
    op: "eq",
    valueText: "",
    mandatory: false,
    ambiguous: false,
    scope: "any",
    sourceWording: "",
    evidenceUrl: "",
    evidenceQuote: "",
    evidenceVerifiedAt: "",
  };
}

/** طلب خام واحد يصل إلى error.details (يستعمل لمسودة الرابط فقط) */
async function rawPost(
  path: string,
  body: unknown,
): Promise<{
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; details?: unknown };
}> {
  const res = await fetch(`/api/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  let payload: { ok: boolean; data?: unknown; error?: { code: string; message: string; details?: unknown } } | null = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return {
    ok: res.ok && payload?.ok === true,
    data: payload?.data,
    error: payload?.error,
  };
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** تحويل نص القيمة إلى قيمة JSON حسب العملية */
function parseConditionValue(op: string, text: string): unknown {
  const trimmed = text.trim();
  if (op === "exists") return null;
  if (op === "in" || op === "not_in") {
    return trimmed
      .split(/[,،]/)
      .map((s) => s.trim())
      .filter((s) => s !== "");
  }
  if (op === "between") {
    const parts = trimmed.split(/[,،]/).map((s) => s.trim());
    return [Number(parts[0] ?? 0), Number(parts[1] ?? 0)];
  }
  if (op === "gte" || op === "lte") return Number(trimmed || 0);
  // eq / neq / contains — رقم إن كان رقمًا وإلا نص
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function validateCondition(row: ConditionDraft): string | null {
  if (!row.field) return "اختر حقل الشرط";
  const v = row.valueText.trim();
  if (row.op === "exists") {
    // لا قيمة مطلوبة
  } else if (row.op === "in" || row.op === "not_in") {
    if (v === "") return "أدخل قيمة واحدة على الأقل مفصولة بفواصل";
  } else if (row.op === "between") {
    const parts = v.split(/[,،]/).map((s) => s.trim());
    if (parts.length !== 2 || !parts.every((p) => /^-?\d+(\.\d+)?$/.test(p)))
      return "أدخل رقمين مفصولين بفاصلة (min,max)";
  } else if (row.op === "gte" || row.op === "lte") {
    if (!/^-?\d+(\.\d+)?$/.test(v)) return "أدخل رقمًا";
  } else if (v === "") {
    return "أدخل قيمة الشرط";
  }
  const hasEvidence =
    row.evidenceUrl.trim() !== "" ||
    row.evidenceQuote.trim() !== "" ||
    row.evidenceVerifiedAt !== "";
  if (
    hasEvidence &&
    (row.evidenceUrl.trim() === "" ||
      row.evidenceQuote.trim().length < 5 ||
      row.evidenceVerifiedAt === "")
  ) {
    return "أكمل الدليل كاملًا (رابط + اقتباس ≥ 5 محارف + تاريخ) أو اتركه فارغًا";
  }
  return null;
}

function buildCondition(row: ConditionDraft) {
  const value = parseConditionValue(row.op, row.valueText);
  const hasEvidence =
    row.evidenceUrl.trim() !== "" &&
    row.evidenceQuote.trim().length >= 5 &&
    row.evidenceVerifiedAt !== "";
  return {
    field: row.field,
    op: row.op,
    value,
    mandatory: row.mandatory,
    ambiguous: row.ambiguous,
    scope: row.scope,
    ...(row.sourceWording.trim() !== "" ? { sourceWording: row.sourceWording.trim() } : {}),
    ...(hasEvidence
      ? {
          evidence: {
            url: row.evidenceUrl.trim(),
            quote: row.evidenceQuote.trim(),
            verifiedAt: new Date(row.evidenceVerifiedAt).toISOString(),
          },
        }
      : {}),
  };
}

// ————— محرر الشروط الديناميكية (يُشارك بين الإنشاء والتحديث) —————

function ConditionsEditor({
  rows,
  setRows,
  t,
}: {
  rows: ConditionDraft[];
  setRows: React.Dispatch<React.SetStateAction<ConditionDraft[]>>;
  t: (ar: string, en: string) => string;
}) {
  const update = (i: number, patch: Partial<ConditionDraft>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) =>
    setRows((prev) => prev.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-3">
      {rows.map((row, i) => {
        const err = validateCondition(row);
        const opConf = OP_OPTIONS.find((o) => o.value === row.op);
        const noValue = row.op === "exists";
        return (
          <Card key={i} className={cn("p-4", err && "border-rose-400")}>
            <div className="flex items-center justify-between gap-2">
              <h5 className="text-sm font-semibold">
                {t(`الشرط ${i + 1}`, `Condition ${i + 1}`)}
              </h5>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => remove(i)}
                className="size-11 text-rose-700 hover:text-rose-800 dark:text-rose-400"
                aria-label={t("حذف الشرط", "Remove condition")}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor={`cond-field-${i}`}>{t("الحقل", "Field")}</Label>
                <Select
                  value={row.field}
                  onValueChange={(v) => update(i, { field: v })}
                >
                  <SelectTrigger id={`cond-field-${i}`} className="h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {PROFILE_FIELD_KEYS.map((f) => (
                      <SelectItem key={f} value={f} className="h-11">
                        {FIELD_LABELS[f] ?? f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`cond-op-${i}`}>{t("العملية", "Operator")}</Label>
                <Select value={row.op} onValueChange={(v) => update(i, { op: v })}>
                  <SelectTrigger id={`cond-op-${i}`} className="h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OP_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="h-11">
                        {t(o.ar, o.en)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`cond-value-${i}`}>{t("القيمة", "Value")}</Label>
                {noValue ? (
                  <p className="flex h-11 items-center rounded-md border border-dashed px-3 text-xs text-muted-foreground">
                    {t("بلا قيمة — يكفي وجود الحقل", "No value — existence only")}
                  </p>
                ) : (
                  <Input
                    id={`cond-value-${i}`}
                    dir="auto"
                    value={row.valueText}
                    placeholder={opConf?.hint ?? ""}
                    onChange={(e) => update(i, { valueText: e.target.value })}
                    className="h-11"
                    aria-describedby={err ? `cond-err-${i}` : undefined}
                  />
                )}
                {opConf ? (
                  <p className="text-xs text-muted-foreground">
                    {t(opConf.hint, opConf.hint)}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`cond-mandatory-${i}`}
                  checked={row.mandatory}
                  onCheckedChange={(c) => update(i, { mandatory: c === true })}
                  className="size-5"
                />
                <Label htmlFor={`cond-mandatory-${i}`} className="text-sm font-normal">
                  {t("إلزامي", "Mandatory")}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`cond-ambiguous-${i}`}
                  checked={row.ambiguous}
                  onCheckedChange={(c) => update(i, { ambiguous: c === true })}
                  className="size-5"
                />
                <Label htmlFor={`cond-ambiguous-${i}`} className="text-sm font-normal">
                  {t("صياغة غامضة", "Ambiguous")}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor={`cond-scope-${i}`} className="text-sm font-normal">
                  {t("النطاق:", "Scope:")}
                </Label>
                <Select
                  value={row.scope}
                  onValueChange={(v) => update(i, { scope: v })}
                >
                  <SelectTrigger id={`cond-scope-${i}`} className="h-11 w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any" className="h-11">
                      {t("يكفي مؤسس (any)", "Any founder")}
                    </SelectItem>
                    <SelectItem value="all" className="h-11">
                      {t("جميع المؤسسين (all)", "All founders")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-3 space-y-1.5">
              <Label htmlFor={`cond-wording-${i}`}>
                {t("عبارة الجهة كما وردت (اختياري)", "Source wording (optional)")}
              </Label>
              <Input
                id={`cond-wording-${i}`}
                dir="rtl"
                value={row.sourceWording}
                maxLength={1200}
                onChange={(e) => update(i, { sourceWording: e.target.value })}
                className="h-11"
              />
            </div>

            <div className="mt-3 rounded-lg border bg-muted/40 p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                {t(
                  "الدليل (اختياري لكنه يرفع الموثوقية ويمنع تقييد الحكم بلا دليل)",
                  "Evidence (optional — boosts reliability and avoids a NO_EVIDENCE cap)",
                )}
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <Input
                  dir="ltr"
                  value={row.evidenceUrl}
                  placeholder="https://..."
                  onChange={(e) => update(i, { evidenceUrl: e.target.value })}
                  className="h-11"
                  aria-label={t("رابط الدليل", "Evidence URL")}
                />
                <Input
                  dir="rtl"
                  value={row.evidenceQuote}
                  maxLength={1200}
                  placeholder={t("الاقتباس الحرفي", "Literal quote")}
                  onChange={(e) => update(i, { evidenceQuote: e.target.value })}
                  className="h-11"
                  aria-label={t("اقتباس الدليل", "Evidence quote")}
                />
                <Input
                  type="date"
                  value={row.evidenceVerifiedAt}
                  onChange={(e) => update(i, { evidenceVerifiedAt: e.target.value })}
                  className="h-11"
                  aria-label={t("تاريخ التحقق", "Verified at")}
                />
              </div>
            </div>

            {err ? (
              <p
                id={`cond-err-${i}`}
                className="mt-2 flex items-center gap-1.5 text-xs text-rose-700 dark:text-rose-400"
              >
                <AlertTriangle className="size-3.5" aria-hidden />
                {t(err, err)}
              </p>
            ) : null}
          </Card>
        );
      })}

      <Button
        type="button"
        variant="outline"
        onClick={() => setRows((prev) => [...prev, emptyCondition()])}
        className="h-11"
      >
        <Plus className="size-4" aria-hidden />
        {t("إضافة شرط", "Add condition")}
      </Button>
    </div>
  );
}

// ————— المكوّن الرئيسي —————

export default function AdminView(_props: ViewProps) {
  const { t, lang } = useI18n();

  // الدور
  const [role, setRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [roleError, setRoleError] = useState<string | null>(null);

  // قائمة الانتظار
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [busyOppId, setBusyOppId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<QueueItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  // الفرص المنشورة (لقائمة الانتظار + تبويب التحديث)
  const [published, setPublished] = useState<PublishedItem[]>([]);

  // التكرارات
  const [pairs, setPairs] = useState<DuplicatePair[] | null>(null);
  const [dupsLoading, setDupsLoading] = useState(true);

  // نموذج الإنشاء
  const [form, setForm] = useState({
    title: "",
    orgName: "",
    description: "",
    type: "grant",
    fundingType: UNSET,
    amountMin: "",
    amountMax: "",
    currency: "USD",
    sectors: [] as string[],
    stageMin: UNSET,
    stageMax: UNSET,
    geography: "local",
    geoPriority: false,
    languages: ["ar"] as string[],
    applicationUrl: "",
    sourceType: "official",
    deadline: "",
    deadlineTz: "Asia/Hebron",
    requiresDocs: [] as string[],
  });
  const [condRows, setCondRows] = useState<ConditionDraft[]>([emptyCondition()]);
  const [creating, setCreating] = useState(false);

  // مسودة من رابط
  const [draftUrl, setDraftUrl] = useState("");
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftResult, setDraftResult] = useState<{
    ok: boolean;
    message: string;
    draft?: unknown;
    quotes?: Array<{ url?: string; quote?: string }>;
    issuesAr?: string[];
    nextStep?: string;
  } | null>(null);

  // تحديث منشورة
  const [updateOppId, setUpdateOppId] = useState("");
  const [updateForm, setUpdateForm] = useState({
    deadline: "",
    amountMin: "",
    amountMax: "",
    reason: "",
  });
  const [updateRows, setUpdateRows] = useState<ConditionDraft[]>([]);
  const [updating, setUpdating] = useState(false);

  // ————— الدور —————
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<{ user?: { role?: string } }>("/auth/me");
        const d = (data ?? {}) as Record<string, unknown>;
        const u = d.user as { role?: string } | undefined;
        if (!cancelled) setRole(String(u?.role ?? ""));
      } catch (e) {
        if (!cancelled)
          setRoleError(
            e instanceof Error
              ? e.message
              : t("تعذّر التحقق من الجلسة", "Could not verify session"),
          );
      } finally {
        if (!cancelled) setRoleLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  // ————— تحميل بيانات اللوحة —————
  const loadBoard = useCallback(async () => {
    setQueueLoading(true);
    setDupsLoading(true);
    try {
      const [allRes, dupRes] = await Promise.allSettled([
        api.get<unknown>("/opportunities?scope=admin&take=100"),
        api.get<unknown>("/admin/duplicates"),
      ]);

      const pubItems: PublishedItem[] = [];
      if (allRes.status === "fulfilled") {
        const d = (allRes.value ?? {}) as Record<string, unknown>;
        const items = Array.isArray(d.items) ? d.items : Array.isArray(allRes.value) ? allRes.value : [];
        for (const it of arr<Record<string, unknown>>(items)) {
          pubItems.push({
            id: String(it.id ?? ""),
            title: String(it.title ?? ""),
            orgName: String(it.orgName ?? ""),
            type: String(it.type ?? ""),
            deadline: (it.deadline ?? null) as string | null,
            status: String(it.status ?? "PUBLISHED"),
          });
        }
      }
      setPublished(pubItems);

      const dupPairs: DuplicatePair[] = [];
      if (dupRes.status === "fulfilled") {
        const d = (dupRes.value ?? {}) as Record<string, unknown>;
        dupPairs.push(...arr<DuplicatePair>(d.pairs ?? d.duplicates ?? []));
      }
      setPairs(dupPairs);

      // قائمة الانتظار: كل الحالات من النطاق الإداري (غير المنشورة أولًا ثم المنشورة)
      const seen = new Set<string>();
      const items: QueueItem[] = [];
      const ORDER: Record<string, number> = { NEEDS_REVIEW: 0, DRAFT: 1, REJECTED: 2, ARCHIVED: 3, PUBLISHED: 4 };
      for (const p of [...pubItems].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9))) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        items.push({
          id: p.id,
          title: p.title,
          orgName: p.orgName,
          status: p.status,
          type: p.type,
          deadline: p.deadline,
          conditionsCount: null,
        });
      }
      // أي غير منشورة لم يغطّها النطاق الإداري (احتياط) من كاشف التكرارات
      for (const p of dupPairs) {
        for (const cand of [p.a, p.b]) {
          if (!cand || seen.has(cand.id)) continue;
          if (cand.status === "PUBLISHED") continue;
          seen.add(cand.id);
          items.push({
            id: cand.id,
            title: cand.title,
            orgName: cand.orgName,
            status: cand.status,
            type: cand.type,
            deadline: null,
            conditionsCount: null,
            partial: true,
          });
        }
      }
      setQueue(items);
    } finally {
      setQueueLoading(false);
      setDupsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (role === "REVIEWER" || role === "ADMIN") void loadBoard();
  }, [role, loadBoard]);

  // إدراج فرصة مُنشأة محليًا في رأس قائمة الانتظار
  const prependToQueue = useCallback((item: QueueItem) => {
    setQueue((prev) => [item, ...(prev ?? []).filter((q) => q.id !== item.id)]);
  }, []);

  // ————— أزرار الحالة —————
  const actOnOpportunity = useCallback(
    async (
      item: QueueItem,
      action: "submit-review" | "publish",
    ) => {
      setBusyOppId(item.id);
      try {
        const data = await api.post<Record<string, unknown>>(
          `/admin/opportunities/${item.id}/${action}`,
        );
        const newStatus =
          action === "submit-review" ? "NEEDS_REVIEW" : "PUBLISHED";
        setQueue((cur) =>
          (cur ?? []).map((q) =>
            q.id === item.id ? { ...q, status: newStatus, partial: false } : q,
          ),
        );
        if (action === "publish") {
          const warnings = arr<string>(data?.warningsAr);
          if (warnings.length > 0) {
            toast.warning(warnings.join(" — "));
          } else {
            toast.success(
              t(
                `نُشرت «${item.title}» — الرابط موثّق بتاريخ النشر`,
                `“${item.title}” published — link verified at publish time`,
              ),
            );
          }
        } else {
          toast.success(
            t(
              `أُرسلت «${item.title}» للمراجعة — نشرها يتطلب مراجعًا ثانيًا`,
              `“${item.title}” submitted for review — publishing needs a second reviewer`,
            ),
          );
        }
      } catch (e) {
        toast.error(
          e instanceof Error && e.message
            ? e.message
            : t("تعذّر تنفيذ الإجراء", "Action failed"),
        );
      } finally {
        setBusyOppId(null);
      }
    },
    [t],
  );

  const rejectOpportunity = useCallback(async () => {
    if (!rejectTarget) return;
    if (rejectReason.trim().length < 3) {
      toast.error(t("سبب الرفض إلزامي (3 محارف على الأقل)", "A rejection reason is required (min 3 chars)"));
      return;
    }
    setRejecting(true);
    try {
      await api.post<unknown>(
        `/admin/opportunities/${rejectTarget.id}/reject`,
        { reason: rejectReason.trim() },
      );
      setQueue((cur) =>
        (cur ?? []).map((q) =>
          q.id === rejectTarget.id
            ? { ...q, status: "REJECTED", rejectReason: rejectReason.trim() }
            : q,
        ),
      );
      toast.success(
        t(
          `رُفضت «${rejectTarget.title}» بالسبب المسجَّل`,
          `“${rejectTarget.title}” rejected with the recorded reason`,
        ),
      );
      setRejectTarget(null);
      setRejectReason("");
    } catch (e) {
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : t("تعذّر رفض الفرصة", "Could not reject"),
      );
    } finally {
      setRejecting(false);
    }
  }, [rejectTarget, rejectReason, t]);

  // ————— إنشاء L0 —————
  const createOpportunity = useCallback(async () => {
    if (form.title.trim().length < 3) {
      toast.error(t("العنوان مطلوب (3 محارف على الأقل)", "Title is required (min 3 chars)"));
      return;
    }
    if (form.orgName.trim().length < 2) {
      toast.error(t("الجهة مطلوبة", "Org name is required"));
      return;
    }
    if (form.sectors.length === 0) {
      toast.error(t("اختر قطاعًا واحدًا على الأقل", "Pick at least one sector"));
      return;
    }
    if (form.languages.length === 0) {
      toast.error(t("اختر لغة واحدة على الأقل", "Pick at least one language"));
      return;
    }
    try {
      if (form.applicationUrl.trim() !== "") {
        new URL(form.applicationUrl.trim());
      }
    } catch {
      toast.error(t("رابط التقديم غير صالح", "Invalid application URL"));
      return;
    }
    if (condRows.length === 0) {
      toast.error(t("أضف شرطًا واحدًا على الأقل", "Add at least one condition"));
      return;
    }
    for (let i = 0; i < condRows.length; i++) {
      const err = validateCondition(condRows[i]);
      if (err) {
        toast.error(
          t(`الشرط ${i + 1}: ${err}`, `Condition ${i + 1}: ${err}`),
        );
        return;
      }
    }
    const amountMin = form.amountMin.trim() === "" ? undefined : Number(form.amountMin);
    const amountMax = form.amountMax.trim() === "" ? undefined : Number(form.amountMax);
    if (amountMin !== undefined && (!Number.isFinite(amountMin) || amountMin < 0)) {
      toast.error(t("الحد الأدنى للمبلغ رقم غير سالب", "Amount min must be a non-negative number"));
      return;
    }
    if (amountMax !== undefined && (!Number.isFinite(amountMax) || amountMax < 0)) {
      toast.error(t("الحد الأقصى للمبلغ رقم غير سالب", "Amount max must be a non-negative number"));
      return;
    }
    let deadlineIso: string | undefined;
    if (form.deadline.trim() !== "") {
      const d = new Date(form.deadline);
      if (Number.isNaN(d.getTime())) {
        toast.error(t("الموعد النهائي غير صالح", "Invalid deadline"));
        return;
      }
      deadlineIso = d.toISOString();
    }

    const body = {
      title: form.title.trim(),
      orgName: form.orgName.trim(),
      description: form.description.trim(),
      type: form.type,
      ...(form.fundingType !== UNSET ? { fundingType: form.fundingType } : {}),
      ...(amountMin !== undefined ? { amountMin } : {}),
      ...(amountMax !== undefined ? { amountMax } : {}),
      currency: form.currency,
      sectors: form.sectors,
      ...(form.stageMin !== UNSET ? { stageMin: form.stageMin } : {}),
      ...(form.stageMax !== UNSET ? { stageMax: form.stageMax } : {}),
      geography: form.geography,
      geoPriority: form.geoPriority,
      languages: form.languages,
      applicationUrl: form.applicationUrl.trim(),
      sourceType: form.sourceType,
      ...(deadlineIso ? { deadline: deadlineIso } : {}),
      deadlineTz: form.deadlineTz,
      requiresDocs: form.requiresDocs,
      conditions: condRows.map(buildCondition),
    };

    setCreating(true);
    try {
      const data = await api.post<{ opportunity?: Record<string, unknown> }>(
        "/admin/opportunities",
        body,
      );
      toast.success(
        t(
          "أُنشئت المسودة — أرسلها للمراجعة من قائمة الانتظار",
          "Draft created — submit it for review from the queue",
        ),
      );
      const opp = (data as Record<string, unknown>)?.opportunity as
        | Record<string, unknown>
        | undefined;
      if (opp?.id) {
        const conds = arr<unknown>(opp.conditions);
        prependToQueue({
          id: String(opp.id),
          title: String(opp.title ?? body.title),
          orgName: String(opp.orgName ?? body.orgName),
          status: String(opp.status ?? "DRAFT"),
          type: String(opp.type ?? body.type),
          deadline: (opp.deadline ?? null) as string | null,
          conditionsCount: conds.length || body.conditions.length,
        });
      }
      // تفريغ النموذج
      setForm({
        title: "",
        orgName: "",
        description: "",
        type: "grant",
        fundingType: UNSET,
        amountMin: "",
        amountMax: "",
        currency: "USD",
        sectors: [],
        stageMin: UNSET,
        stageMax: UNSET,
        geography: "local",
        geoPriority: false,
        languages: ["ar"],
        applicationUrl: "",
        sourceType: "official",
        deadline: "",
        deadlineTz: "Asia/Hebron",
        requiresDocs: [],
      });
      setCondRows([emptyCondition()]);
    } catch (e) {
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : t("تعذّر إنشاء الفرصة", "Could not create the opportunity"),
      );
    } finally {
      setCreating(false);
    }
  }, [form, condRows, prependToQueue, t]);

  // ————— مسودة من رابط —————
  const createDraftFromUrl = useCallback(async () => {
    const url = draftUrl.trim();
    if (url === "") {
      toast.error(t("أدخل رابط الصفحة", "Enter the page URL"));
      return;
    }
    try {
      new URL(url);
    } catch {
      toast.error(t("الرابط غير صالح", "Invalid URL"));
      return;
    }
    setDraftBusy(true);
    setDraftResult(null);
    try {
      const res = await rawPost("/admin/opportunities/draft-from-url", { url });
      if (res.ok) {
        const d = (res.data ?? {}) as Record<string, unknown>;
        const opp = (d.opportunity ?? null) as Record<string, unknown> | null;
        toast.success(
          String(d.note ?? t("أُنشئت مسودة آلية — تحتاج مراجعة بشرية", "Auto-draft created — needs human review")),
        );
        setDraftResult({
          ok: true,
          message: String(
            d.note ?? t("مسودة آلية من رابط — تحتاج إكمالًا يدويًا", "Auto draft — needs manual completion"),
          ),
          draft: opp ?? d,
          // نجاح المسودة يُرجع عدّادًا فقط — الاقتباسات الحرفية تُعرض في حالة الفشل الآمن
          quotes: [],
          nextStep: d.nextStep ? String(d.nextStep) : undefined,
        });
        if (opp?.id) {
          const conds = arr<unknown>(opp.conditions);
          prependToQueue({
            id: String(opp.id),
            title: String(opp.title ?? ""),
            orgName: String(opp.orgName ?? ""),
            status: String(opp.status ?? "DRAFT"),
            type: String(opp.type ?? ""),
            deadline: (opp.deadline ?? null) as string | null,
            conditionsCount: conds.length,
          });
        }
      } else {
        const err = res.error;
        toast.error(err?.message ?? t("تعذّر إنشاء المسودة", "Could not create the draft"));
        const details = (err?.details ?? {}) as Record<string, unknown>;
        setDraftResult({
          ok: false,
          message: err?.message ?? "",
          draft: details.draft,
          quotes: arr<Record<string, unknown>>(details.quotes).map((q) => ({
            url: q.url ? String(q.url) : undefined,
            quote: q.quote ? String(q.quote) : undefined,
          })),
          issuesAr: arr<string>(details.issuesAr),
        });
      }
    } catch {
      toast.error(t("تعذّر الاتصال بالخادم", "Server unreachable"));
    } finally {
      setDraftBusy(false);
    }
  }, [draftUrl, prependToQueue, t]);

  // ————— تحديث منشورة —————
  const updatePublished = useCallback(async () => {
    if (!updateOppId) {
      toast.error(t("اختر فرصة منشورة", "Pick a published opportunity"));
      return;
    }
    let deadlineIso: string | undefined;
    if (updateForm.deadline.trim() !== "") {
      const d = new Date(updateForm.deadline);
      if (Number.isNaN(d.getTime())) {
        toast.error(t("الموعد النهائي غير صالح", "Invalid deadline"));
        return;
      }
      deadlineIso = d.toISOString();
    }
    const amountMin =
      updateForm.amountMin.trim() === ""
        ? undefined
        : Number(updateForm.amountMin);
    const amountMax =
      updateForm.amountMax.trim() === ""
        ? undefined
        : Number(updateForm.amountMax);
    if (amountMin !== undefined && !Number.isFinite(amountMin)) {
      toast.error(t("الحد الأدنى للمبلغ غير صالح", "Invalid amount min"));
      return;
    }
    if (amountMax !== undefined && !Number.isFinite(amountMax)) {
      toast.error(t("الحد الأقصى للمبلغ غير صالح", "Invalid amount max"));
      return;
    }
    for (let i = 0; i < updateRows.length; i++) {
      const err = validateCondition(updateRows[i]);
      if (err) {
        toast.error(t(`الشرط ${i + 1}: ${err}`, `Condition ${i + 1}: ${err}`));
        return;
      }
    }
    if (
      deadlineIso === undefined &&
      amountMin === undefined &&
      amountMax === undefined &&
      updateRows.length === 0
    ) {
      toast.info(
        t(
          "لا تغييرات — عدّل الموعد أو المبلغ أو أضف الشروط الجديدة كاملة",
          "No changes — edit deadline/amount or provide the full new conditions",
        ),
      );
      return;
    }

    const patch: Record<string, unknown> = {};
    if (deadlineIso !== undefined) patch.deadline = deadlineIso;
    if (amountMin !== undefined) patch.amountMin = amountMin;
    if (amountMax !== undefined) patch.amountMax = amountMax;
    if (updateRows.length > 0) {
      patch.conditions = updateRows.map(buildCondition);
    }

    setUpdating(true);
    try {
      const data = await api.post<{
        version?: { versionNumber?: number };
        notified?: number;
      }>(`/admin/opportunities/${updateOppId}/update`, {
        ...(updateForm.reason.trim() !== ""
          ? { reason: updateForm.reason.trim() }
          : {}),
        patch,
      });
      const vNum = Number(
        (data as Record<string, unknown>)?.version
          ? ((data as Record<string, { versionNumber?: number }>).version.versionNumber ?? 0)
          : 0,
      );
      const notified = Number((data as Record<string, unknown>)?.notified ?? 0);
      toast.success(
        t(
          `أُنشئت نسخة ${vNum} وأُشعر ${notified} مستخدمًا`,
          `Version ${vNum} created; ${notified} user(s) notified`,
        ),
      );
      setUpdateForm({ deadline: "", amountMin: "", amountMax: "", reason: "" });
      setUpdateRows([]);
    } catch (e) {
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : t("تعذّر تحديث الفرصة", "Could not update the opportunity"),
      );
    } finally {
      setUpdating(false);
    }
  }, [updateOppId, updateForm, updateRows, t]);

  // ————— عناصر مساعدة —————

  const statusBadge = (status: string) => {
    const conf = OPP_STATUS_CONF[status] ?? {
      ar: status,
      en: status,
      cls: "border-border bg-muted text-muted-foreground",
    };
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
          conf.cls,
        )}
      >
        {t(conf.ar, conf.en)}
      </span>
    );
  };

  const chip = (
    label: string,
    active: boolean,
    onClick: () => void,
    key: string,
  ) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-h-11 rounded-full border px-3 py-1.5 text-sm transition-colors",
        active
          ? "border-teal-600 bg-teal-100 text-teal-900 dark:border-teal-500 dark:bg-teal-950 dark:text-teal-200"
          : "border-border bg-card text-muted-foreground hover:bg-accent",
      )}
    >
      {label}
    </button>
  );

  // ————— شاشات التبويبات —————

  const renderQueue = () => {
    if (queueLoading) {
      return (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      );
    }
    if (!queue || queue.length === 0) {
      return (
        <EmptyState
          iconAr="🗂️"
          title={t("لا فرص في قائمة الانتظار", "Queue is empty")}
          hintAr={t(
            "أنشئ فرصة من تبويب «إنشاء فرصة» أو «مسودة من رابط»، وستظهر هنا لإرسالها للمراجعة والنشر.",
            "Create an opportunity via “Create” or “Draft from URL”; it will appear here for review and publishing.",
          )}
        />
      );
    }
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {t(
            "المسودات وغير المحسومة تُجلب من كاشف التكرارات (بيانات جزئية)، والمنشورة من قائمة الفرص — لا يوجد مسار قائمة إداري في العقد.",
            "Drafts/review items come from the duplicates detector (partial data); published ones from the opportunities list — no admin list route exists in the contract.",
          )}
        </p>
        <ul className={cn("space-y-2", SCROLL_CLS)}>
          {queue.map((q) => (
            <li key={q.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-bold text-sm break-words">{q.title}</h4>
                      {statusBadge(q.status)}
                    </div>
                    <p className="text-sm text-muted-foreground">{q.orgName}</p>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>
                        {q.deadline
                          ? formatDate(q.deadline, lang)
                          : t("بلا موعد", "No deadline")}
                      </span>
                      <span>
                        {t("عدد الشروط", "Conditions")}:{" "}
                        <span className="tabular-nums" dir="ltr">
                          {q.conditionsCount ?? "—"}
                        </span>
                      </span>
                      {q.partial ? (
                        <Badge variant="outline" className="text-xs">
                          {t("بيانات جزئية", "Partial data")}
                        </Badge>
                      ) : null}
                    </div>
                    {q.rejectReason ? (
                      <p className="text-xs text-rose-700 dark:text-rose-400">
                        {t("سبب الرفض", "Rejection reason")}: {q.rejectReason}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {q.status === "DRAFT" ? (
                      <Button
                        size="sm"
                        onClick={() => void actOnOpportunity(q, "submit-review")}
                        disabled={busyOppId === q.id}
                        className="h-11"
                      >
                        {busyOppId === q.id ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        ) : (
                          <ClipboardCheck className="size-4" aria-hidden />
                        )}
                        {t("إرسال للمراجعة", "Submit for review")}
                      </Button>
                    ) : null}
                    {q.status === "NEEDS_REVIEW" ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => void actOnOpportunity(q, "publish")}
                          disabled={busyOppId === q.id}
                          className="h-11"
                        >
                          {busyOppId === q.id ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                          ) : (
                            <CheckCircle2 className="size-4" aria-hidden />
                          )}
                          {t("نشر", "Publish")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setRejectTarget(q);
                            setRejectReason("");
                          }}
                          className="h-11 text-rose-700 hover:text-rose-800 dark:text-rose-400"
                        >
                          <X className="size-4" aria-hidden />
                          {t("رفض", "Reject")}
                        </Button>
                      </>
                    ) : null}
                    {q.status === "PUBLISHED" ? (
                      <Badge
                        variant="outline"
                        className="border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300"
                      >
                        <CheckCircle2 className="size-3.5" aria-hidden />
                        {t("منشورة وموثّقة", "Published & verified")}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const renderCreate = () => (
    <div className="space-y-4">
      <Alert>
        <ShieldAlert className="size-4" aria-hidden />
        <AlertTitle>
          {t("قاعدة الاعتماد", "Approval rule")}
        </AlertTitle>
        <AlertDescription>
          {t(
            "لا يعتمد كاتب المسودة عمله: بعد الإنشاء (DRAFT) أرسلها للمراجعة، ويجب أن ينشرها مراجع آخر غيرك — وإلا رُفض الطلب بSELF_APPROVAL.",
            "Draft authors cannot self-approve: after creation (DRAFT) submit for review; a different reviewer must publish — otherwise the request fails with SELF_APPROVAL.",
          )}
        </AlertDescription>
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="opp-title">{t("العنوان", "Title")} *</Label>
          <Input
            id="opp-title"
            dir="rtl"
            value={form.title}
            maxLength={160}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="h-11"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="opp-org">{t("الجهة", "Organization")} *</Label>
          <Input
            id="opp-org"
            dir="rtl"
            value={form.orgName}
            maxLength={120}
            onChange={(e) => setForm((f) => ({ ...f, orgName: e.target.value }))}
            className="h-11"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="opp-desc">{t("الوصف", "Description")}</Label>
        <Textarea
          id="opp-desc"
          dir="rtl"
          rows={3}
          maxLength={4000}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="opp-type">{t("النوع", "Type")} *</Label>
          <Select
            value={form.type}
            onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}
          >
            <SelectTrigger id="opp-type" className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPP_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="h-11">
                  {t(o.ar, o.en)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="opp-ftype">{t("نوع التمويل", "Funding type")}</Label>
          <Select
            value={form.fundingType}
            onValueChange={(v) => setForm((f) => ({ ...f, fundingType: v }))}
          >
            <SelectTrigger id="opp-ftype" className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET} className="h-11">
                {t("بلا تحديد", "Unspecified")}
              </SelectItem>
              {FUNDING_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="h-11">
                  {t(o.ar, o.en)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="opp-amin">{t("الحد الأدنى للمبلغ", "Amount min")}</Label>
          <Input
            id="opp-amin"
            dir="ltr"
            type="number"
            min={0}
            value={form.amountMin}
            onChange={(e) => setForm((f) => ({ ...f, amountMin: e.target.value }))}
            className="h-11"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="opp-amax">{t("الحد الأقصى للمبلغ", "Amount max")}</Label>
          <Input
            id="opp-amax"
            dir="ltr"
            type="number"
            min={0}
            value={form.amountMax}
            onChange={(e) => setForm((f) => ({ ...f, amountMax: e.target.value }))}
            className="h-11"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="opp-currency">{t("العملة", "Currency")}</Label>
          <Select
            value={form.currency}
            onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}
          >
            <SelectTrigger id="opp-currency" className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCY_OPTIONS.map((c) => (
                <SelectItem key={c} value={c} className="h-11">
                  <span dir="ltr">{c}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="opp-smin">{t("المرحلة الدنيا", "Stage min")}</Label>
          <Select
            value={form.stageMin}
            onValueChange={(v) => setForm((f) => ({ ...f, stageMin: v }))}
          >
            <SelectTrigger id="opp-smin" className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET} className="h-11">
                {t("بلا تحديد", "Unspecified")}
              </SelectItem>
              {STAGE_KEYS.map((s) => (
                <SelectItem key={s} value={s} className="h-11">
                  {STAGE_LABELS[s] ?? s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="opp-smax">{t("المرحلة العليا", "Stage max")}</Label>
          <Select
            value={form.stageMax}
            onValueChange={(v) => setForm((f) => ({ ...f, stageMax: v }))}
          >
            <SelectTrigger id="opp-smax" className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET} className="h-11">
                {t("بلا تحديد", "Unspecified")}
              </SelectItem>
              {STAGE_KEYS.map((s) => (
                <SelectItem key={s} value={s} className="h-11">
                  {STAGE_LABELS[s] ?? s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="opp-geo">{t("النطاق الجغرافي", "Geography")}</Label>
          <Select
            value={form.geography}
            onValueChange={(v) => setForm((f) => ({ ...f, geography: v }))}
          >
            <SelectTrigger id="opp-geo" className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GEOGRAPHY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="h-11">
                  {t(o.ar, o.en)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t("القطاعات", "Sectors")} *</Label>
        <div className="flex flex-wrap gap-2">
          {SECTOR_KEYS.map((s) =>
            chip(
              SECTOR_LABELS[s] ?? s,
              form.sectors.includes(s),
              () =>
                setForm((f) => ({
                  ...f,
                  sectors: f.sectors.includes(s)
                    ? f.sectors.filter((x) => x !== s)
                    : [...f.sectors, s],
                })),
              s,
            ),
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Switch
            id="opp-geopri"
            checked={form.geoPriority}
            onCheckedChange={(c) => setForm((f) => ({ ...f, geoPriority: c }))}
            className="scale-110"
          />
          <Label htmlFor="opp-geopri" className="text-sm font-normal">
            {t("أولوية جغرافية (فلسطين أولًا)", "Geo priority")}
          </Label>
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t("لغات التقديم", "Application languages")} *</Label>
        <div className="flex flex-wrap gap-2">
          {["ar", "en"].map((l) =>
            chip(
              l === "ar" ? t("العربية", "Arabic") : t("الإنجليزية", "English"),
              form.languages.includes(l),
              () =>
                setForm((f) => ({
                  ...f,
                  languages: f.languages.includes(l)
                    ? f.languages.filter((x) => x !== l)
                    : [...f.languages, l],
                })),
              l,
            ),
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="opp-url">{t("رابط التقديم", "Application URL")} *</Label>
          <Input
            id="opp-url"
            dir="ltr"
            type="url"
            value={form.applicationUrl}
            onChange={(e) =>
              setForm((f) => ({ ...f, applicationUrl: e.target.value }))
            }
            placeholder="https://..."
            className="h-11"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="opp-source">{t("نوع المصدر", "Source type")}</Label>
          <Select
            value={form.sourceType}
            onValueChange={(v) => setForm((f) => ({ ...f, sourceType: v }))}
          >
            <SelectTrigger id="opp-source" className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="h-11">
                  {t(o.ar, o.en)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="opp-deadline">{t("الموعد النهائي", "Deadline")}</Label>
          <Input
            id="opp-deadline"
            type="datetime-local"
            value={form.deadline}
            onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))}
            className="h-11"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="opp-tz">{t("المنطقة الزمنية للموعد", "Deadline timezone")}</Label>
          <Select
            value={form.deadlineTz}
            onValueChange={(v) => setForm((f) => ({ ...f, deadlineTz: v }))}
          >
            <SelectTrigger id="opp-tz" className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TZ_OPTIONS.map((tz) => (
                <SelectItem key={tz} value={tz} className="h-11">
                  <span dir="ltr">{tz}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t("المستندات المطلوبة", "Required documents")}</Label>
        <div className="flex flex-wrap gap-2">
          {DOC_TYPE_KEYS.map((d) =>
            chip(
              DOC_LABELS[d] ?? d,
              form.requiresDocs.includes(d),
              () =>
                setForm((f) => ({
                  ...f,
                  requiresDocs: f.requiresDocs.includes(d)
                    ? f.requiresDocs.filter((x) => x !== d)
                    : [...f.requiresDocs, d],
                })),
              d,
            ),
          )}
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        <h4 className="font-bold">
          {t("الشروط الديناميكية", "Dynamic conditions")} *
        </h4>
        <ConditionsEditor rows={condRows} setRows={setCondRows} t={t} />
      </div>

      <Button
        onClick={() => void createOpportunity()}
        disabled={creating}
        className="h-11"
      >
        {creating ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <FilePlus2 className="size-4" aria-hidden />
        )}
        {t("إنشاء المسودة (L0)", "Create draft (L0)")}
      </Button>
    </div>
  );

  const renderDraftFromUrl = () => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1 space-y-1.5">
          <Label htmlFor="draft-url">{t("رابط صفحة الفرصة", "Opportunity page URL")}</Label>
          <Input
            id="draft-url"
            dir="ltr"
            type="url"
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            placeholder="https://..."
            className="h-11"
          />
        </div>
        <Button
          onClick={() => void createDraftFromUrl()}
          disabled={draftBusy}
          className="h-11"
        >
          {draftBusy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Link2 className="size-4" aria-hidden />
          )}
          {t("إنشاء مسودة من الرابط", "Create draft from URL")}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {t(
          "يُجلب نص الصفحة (حدود أمنية: مهلة 15 ث، حجم ≤ 2MB، حارس SSRF) ثم يُولّد المسودة بالاقتباسات — الفشل الآمن يعيد المشكلات دون إنشاء سجل ناقص.",
          "The page text is fetched (safety limits: 15s timeout, ≤ 2MB, SSRF guard) then the draft is generated with quotes — safe failure returns issues without creating an incomplete record.",
        )}
      </p>

      {draftResult ? (
        <Card className="p-4">
          <div className="flex items-start gap-2">
            {draftResult.ok ? (
              <CheckCircle2
                className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400"
                aria-hidden
              />
            ) : (
              <AlertTriangle
                className="mt-0.5 size-5 shrink-0 text-amber-600"
                aria-hidden
              />
            )}
            <div className="space-y-2">
              <p className="font-semibold">{draftResult.message}</p>
              <p className="text-sm text-muted-foreground">
                {draftResult.ok
                  ? t(
                      "أُنشئت كمسودة وأُدرجت في قائمة الانتظار — تحتاج إكمالًا يدويًّا ومراجعة قبل النشر.",
                      "Created as a draft and added to the queue — needs manual completion and review before publishing.",
                    )
                  : t(
                      "تحتاج إكمالًا يدويًّا — صحّح البيانات أدناه ثم أنشئ الفرصة من تبويب «إنشاء فرصة».",
                      "Needs manual completion — fix the data below then create the opportunity via the “Create” tab.",
                    )}
              </p>
            </div>
          </div>

          {draftResult.issuesAr && draftResult.issuesAr.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {draftResult.issuesAr.map((issue, i) => (
                <li
                  key={i}
                  className="text-xs text-amber-800 dark:text-amber-300"
                >
                  • {issue}
                </li>
              ))}
            </ul>
          ) : null}

          {draftResult.quotes && draftResult.quotes.length > 0 ? (
            <div className="mt-3 space-y-2">
              <p className="text-sm font-medium">
                {t("الاقتباسات من الصفحة", "Quotes from the page")}
              </p>
              <ul className={cn("space-y-2", SCROLL_CLS)}>
                {draftResult.quotes.map((q, i) => (
                  <li key={i}>
                    <blockquote
                      dir="rtl"
                      className="rounded-e-lg border-s-4 border-teal-400 bg-muted/60 p-2.5 text-sm italic leading-6"
                    >
                      «{q.quote ?? "—"}»
                      {q.url ? (
                        <a
                          href={q.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          dir="ltr"
                          className="mt-1 block break-all text-xs text-teal-700 underline dark:text-teal-400"
                        >
                          {q.url}
                        </a>
                      ) : null}
                    </blockquote>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {draftResult.draft !== undefined && draftResult.draft !== null ? (
            <div className="mt-3 space-y-1.5">
              <p className="text-sm font-medium">
                {t("بيانات المسودة (JSON)", "Draft data (JSON)")}
              </p>
              <pre
                dir="ltr"
                className="max-h-96 overflow-auto rounded-lg border bg-muted/60 p-3 text-xs leading-5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border"
              >
                {JSON.stringify(draftResult.draft, null, 2)}
              </pre>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );

  const renderUpdate = () => (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="upd-opp">{t("الفرصة المنشورة", "Published opportunity")} *</Label>
        {published.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("لا فرص منشورة متاحة حاليًّا.", "No published opportunities available.")}
          </p>
        ) : (
          <Select value={updateOppId || undefined} onValueChange={(v) => setUpdateOppId(v)}>
            <SelectTrigger id="upd-opp" className="h-11 w-full">
              <SelectValue placeholder={t("اختر فرصة منشورة", "Pick a published opportunity")} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {published.map((p) => (
                <SelectItem key={p.id} value={p.id} className="h-11">
                  {p.title} — {p.orgName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {updateOppId ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="upd-deadline">{t("الموعد النهائي الجديد", "New deadline")}</Label>
              <Input
                id="upd-deadline"
                type="datetime-local"
                value={updateForm.deadline}
                onChange={(e) =>
                  setUpdateForm((f) => ({ ...f, deadline: e.target.value }))
                }
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="upd-amin">{t("الحد الأدنى للمبلغ", "Amount min")}</Label>
              <Input
                id="upd-amin"
                dir="ltr"
                type="number"
                min={0}
                value={updateForm.amountMin}
                onChange={(e) =>
                  setUpdateForm((f) => ({ ...f, amountMin: e.target.value }))
                }
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="upd-amax">{t("الحد الأقصى للمبلغ", "Amount max")}</Label>
              <Input
                id="upd-amax"
                dir="ltr"
                type="number"
                min={0}
                value={updateForm.amountMax}
                onChange={(e) =>
                  setUpdateForm((f) => ({ ...f, amountMax: e.target.value }))
                }
                className="h-11"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="upd-reason">{t("سبب التحديث", "Update reason")}</Label>
            <Textarea
              id="upd-reason"
              dir="rtl"
              rows={2}
              maxLength={600}
              value={updateForm.reason}
              onChange={(e) =>
                setUpdateForm((f) => ({ ...f, reason: e.target.value }))
              }
            />
          </div>

          <div className="space-y-2">
            <h4 className="font-bold">
              {t("الشروط الجديدة (استبدال كامل عند التقديم)", "New conditions (full replacement when submitted)")}
            </h4>
            <p className="text-xs text-muted-foreground">
              {t(
                "إن أضفت صفوفًا فستُستبدل شروط الفرصة كلها بها (المسار يستبدل ولا يدمج). اتركها فارغة لتحديث الموعد/المبلغ فقط.",
                "Adding rows replaces ALL the opportunity's conditions (the endpoint replaces, not merges). Leave empty to update deadline/amount only.",
              )}
            </p>
            <ConditionsEditor rows={updateRows} setRows={setUpdateRows} t={t} />
          </div>

          <Button
            onClick={() => void updatePublished()}
            disabled={updating}
            className="h-11"
          >
            {updating ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <FilePenLine className="size-4" aria-hidden />
            )}
            {t("إنشاء نسخة جديدة", "Create new version")}
          </Button>
        </>
      ) : null}
    </div>
  );

  const renderDuplicates = () => {
    if (dupsLoading) {
      return (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      );
    }
    if (!pairs || pairs.length === 0) {
      return (
        <EmptyState
          iconAr="✅"
          title={t("لا تكرارات محتملة", "No likely duplicates")}
          hintAr={t(
            "فُحصت كل الفرص (DRAFT/PUBLISHED) بتشابه العنوان+الجهة (≥ 0.72) وتوحيد الروابط — لا أزواج مشبوهة.",
            "All opportunities (DRAFT/PUBLISHED) were checked by title+org similarity (≥ 0.72) and URL normalization — no suspicious pairs.",
          )}
        />
      );
    }
    return (
      <ul className={cn("space-y-3", SCROLL_CLS)}>
        {pairs.map((p, i) => (
          <li key={i}>
            <Card className="p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-300"
                >
                  <Copy className="size-3.5" aria-hidden />
                  {p.labelAr ?? t("تكرار محتمل", "Likely duplicate")}
                </Badge>
                <Badge variant="secondary" className="tabular-nums" dir="ltr">
                  {(p.similarity * 100).toFixed(0)}%
                </Badge>
                {p.sameUrl ? (
                  <Badge
                    variant="outline"
                    className="border-rose-300 text-rose-700 dark:border-rose-700 dark:text-rose-300"
                  >
                    {t("نفس الرابط الموحّد", "Same normalized URL")}
                  </Badge>
                ) : null}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {[p.a, p.b].map((c, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border p-3"
                    aria-label={idx === 0 ? t("الفرصة الأولى", "First") : t("الفرصة الثانية", "Second")}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {statusBadge(c.status)}
                      <span className="text-xs text-muted-foreground">
                        {c.type}
                      </span>
                    </div>
                    <p className="mt-1.5 font-semibold text-sm break-words">
                      {c.title}
                    </p>
                    <p className="text-sm text-muted-foreground">{c.orgName}</p>
                    {c.normalizedUrl ? (
                      <p dir="ltr" className="mt-1 break-all text-xs text-teal-700 dark:text-teal-400">
                        {c.normalizedUrl}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    );
  };

  // ————— بوابات الدور —————

  if (roleLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-10 w-full max-w-2xl" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (roleError) {
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold">{t("لوحة المراجعة", "Review board")}</h1>
        </header>
        <EmptyState
          iconAr="🔒"
          title={t("تعذّر التحقق من صلاحياتك", "Could not verify your permissions")}
          hintAr={roleError}
        />
      </div>
    );
  }

  if (role !== "REVIEWER" && role !== "ADMIN") {
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold">{t("لوحة المراجعة", "Review board")}</h1>
        </header>
        <EmptyState
          iconAr="🔐"
          title={t("هذه اللوحة متاحة للمراجعين فقط", "This board is for reviewers only")}
          hintAr={t(
            "حسابك الحالي ليس بدور REVIEWER أو ADMIN. إن كنت مراجعًا فسجّل الدخول بحساب المراجع.",
            "Your account is neither REVIEWER nor ADMIN. If you are a reviewer, sign in with the reviewer account.",
          )}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Toaster richColors closeButton position="top-center" dir={lang === "ar" ? "rtl" : "ltr"} />
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t("لوحة المراجعة", "Review board")}</h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "إدارة دورة حياة الفرص: إنشاء المسودات، إرسالها للمراجعة، النشر (بمراجع ثانٍ)، الرفض المسبب، التحديث بالنسخ، وكشف التكرارات.",
            "Manage the opportunity lifecycle: drafts, review submission, publishing (second reviewer), reasoned rejection, versioned updates, and duplicate detection.",
          )}
        </p>
      </header>

      <Tabs defaultValue="queue" dir={lang === "ar" ? "rtl" : "ltr"}>
        <TabsList className="h-auto w-full flex-wrap gap-1 p-1">
          <TabsTrigger value="queue" className="h-11 flex-1 min-w-32 text-xs sm:text-sm">
            {t("قائمة الانتظار", "Queue")}
          </TabsTrigger>
          <TabsTrigger value="create" className="h-11 flex-1 min-w-32 text-xs sm:text-sm">
            {t("إنشاء فرصة (L0)", "Create (L0)")}
          </TabsTrigger>
          <TabsTrigger value="draft" className="h-11 flex-1 min-w-32 text-xs sm:text-sm">
            {t("مسودة من رابط", "Draft from URL")}
          </TabsTrigger>
          <TabsTrigger value="update" className="h-11 flex-1 min-w-32 text-xs sm:text-sm">
            {t("تحديث منشورة", "Update published")}
          </TabsTrigger>
          <TabsTrigger value="dups" className="h-11 flex-1 min-w-32 text-xs sm:text-sm">
            {t("التكرارات", "Duplicates")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadBoard()}
              disabled={queueLoading}
              className="h-11"
              aria-label={t("تحديث", "Refresh")}
            >
              <RefreshCw
                className={cn("size-4", queueLoading && "animate-spin")}
                aria-hidden
              />
            </Button>
          </div>
          {renderQueue()}
        </TabsContent>

        <TabsContent value="create" className="mt-4">
          {renderCreate()}
        </TabsContent>

        <TabsContent value="draft" className="mt-4">
          {renderDraftFromUrl()}
        </TabsContent>

        <TabsContent value="update" className="mt-4">
          {renderUpdate()}
        </TabsContent>

        <TabsContent value="dups" className="mt-4">
          {renderDuplicates()}
        </TabsContent>
      </Tabs>

      {/* حوار الرفض بسبب إلزامي */}
      <Dialog
        open={rejectTarget !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRejectTarget(null);
            setRejectReason("");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("رفض الفرصة", "Reject opportunity")}
              {rejectTarget ? ` — ${rejectTarget.title}` : ""}
            </DialogTitle>
            <DialogDescription>
              {t(
                "السبب إلزامي ويُسجَّل مع الفرصة (الحد الأدنى 3 محارف).",
                "A reason is mandatory and recorded with the opportunity (min 3 chars).",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">{t("سبب الرفض", "Rejection reason")} *</Label>
            <Textarea
              id="reject-reason"
              dir="rtl"
              rows={3}
              maxLength={600}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t(
                "مثال: الرابط لا يعمل، أو الشروط بلا دليل موثق...",
                "e.g. link is broken, or conditions lack documented evidence...",
              )}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setRejectTarget(null);
                setRejectReason("");
              }}
              className="h-11"
            >
              {t("إلغاء", "Cancel")}
            </Button>
            <Button
              onClick={() => void rejectOpportunity()}
              disabled={rejecting || rejectReason.trim().length < 3}
              className="h-11 bg-rose-600 text-white hover:bg-rose-700"
            >
              {rejecting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <X className="size-4" aria-hidden />
              )}
              {t("رفض الفرصة", "Reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
