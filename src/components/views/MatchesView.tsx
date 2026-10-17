"use client";
/**
 * Masar — T16: MatchesView — قائمة الأحكام لملف الشركة بتفسيرها الكامل
 * =============================================================================
 * - GET /matches (T11) → قائمة مرتبة جاهزة (NOT_ELIGIBLE أخيرًا والباقي بالملاءمة
 *   تنازليًا) — نعيد التجميع محليًّا في ثلاثة أقسام ملونة:
 *     مؤهل (أخضر emerald) / غير محسوم (كهرماني amber) / غير مؤهل (أحمر rose)
 *   وداخل كل قسم ترتيب بالملاءمة تنازليًا.
 * - بطاقة لكل فرصة: العنوان + JudgmentBadge + ملخص الحكم + الملاءمة
 *   (ScoreBar بالعدد/100) + زر «لماذا؟» يوسّع:
 *     كل الشروط (expected/actual/الحالة/الدليل برابطه واقتباسه و«آخر تحقق»/
 *     عبارة الجهة الأصلية) + عوامل الملاءمة السبعة بأشرطة وأوزانها +
 *     الأسباب (blocking/uncertain) + الموثوقية مصغرة + زر «تتبّع هذه الفرصة».
 * - أعلى الصفحة: شريط ملخص بعدد كل حكم + زر «جرّب محاكي ماذا لو» → whatif.
 * - Empty states: بلا فرص / بلا ملف (NO_PROFILE → دعوة لإنشاء الملف) /
 *   خطأ (toast sonner + إعادة محاولة).
 * ملاحظة على عقد الواجهة: مسار /matches الفعلي لا يعيد executionNotes —
 * لم يُعرض قسم عوائق التنفيذ (المهمة: «إن وجدت»).
 * القواعد: useI18n().t لكل نص، Skeleton، أخطاء toast sonner، RTL منطقي، لمس ≥44px.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bell,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  HelpCircle,
  Loader2,
  Quote,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EmptyState,
  JudgmentBadge,
  ReliabilityMeter,
  ScoreBar,
} from "@/components/app/badges";
import { formatDate, formatMoney, useI18n } from "@/components/app/i18n";
import type { ViewProps } from "@/components/app/types";
import { api } from "@/lib/api-client";
import type { Judgment } from "@/lib/core/types";

// ————— أشكال الردود (مطابقة لمسار /matches الفعلي — T11) —————

interface MatchCondition {
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

interface FitFactor {
  key: string;
  labelAr: string;
  labelEn?: string;
  weight: number;
  score: number;
  detail: string;
  detailEn?: string;
}

interface MatchItem {
  opportunity: {
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
  };
  judgment: Judgment;
  summary: string;
  summaryEn?: string;
  blockingReasons: string[];
  blockingReasonsEn?: string[];
  uncertainReasons: string[];
  uncertainReasonsEn?: string[];
  conditions: MatchCondition[];
  fit: { total: number; factors: FitFactor[] } | null;
  reliability: { total: number; level: "high" | "medium" | "low"; warningAr?: string; warningEn?: string };
}

interface ApplicationsResponse {
  applications: Array<{ opportunity: { id: string } | null }>;
}

// ————— قواميس ثنائية اللغة (محلية — قاموس موضعي وفق العقد §15) —————

type BiLabel = { ar: string; en: string };

const JUDGMENT_LABELS: Record<Judgment, BiLabel> = {
  ELIGIBLE: { ar: "مؤهل", en: "Eligible" },
  UNCERTAIN: { ar: "غير محسوم", en: "Uncertain" },
  NOT_ELIGIBLE: { ar: "غير مؤهل", en: "Not eligible" },
};

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

const EVIDENCE_STATE_LABELS: Record<string, BiLabel> = {
  ok: { ar: "دليل موثّق", en: "Documented evidence" },
  missing: { ar: "بلا دليل", en: "No evidence" },
  stale: { ar: "دليل قديم", en: "Stale evidence" },
  weak: { ar: "دليل ضعيف", en: "Weak evidence" },
};

// ————— أدوات عرض خالصة —————

type Lang = "ar" | "en";

function biLabel(map: Record<string, BiLabel>, key: string, lang: Lang, fallback?: string): string {
  const entry = map[key];
  if (entry) return lang === "ar" ? entry.ar : entry.en;
  return fallback ?? key;
}

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

function toastError(
  e: unknown,
  t: (ar: string, en: string) => string,
  ar: string,
  en: string,
): void {
  const message = e instanceof Error && e.message.trim() !== "" ? e.message.trim() : "";
  toast.error(message !== "" ? `${t(ar, en)} — ${message}` : t(ar, en));
}

const SCROLLABLE_LIST =
  "max-h-96 overflow-y-auto pe-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border";

// ————— بطاقة شرط من نتيجة التقييم (expected/actual/الحالة/الدليل) —————

function MatchConditionCard({ cond }: { cond: MatchCondition }) {
  const { t, lang } = useI18n();
  const isAmbiguous = cond.unresolvedReason === "AMBIGUOUS_WORDING";
  const evState = cond.evidenceState;
  const cardTone =
    cond.status === "SATISFIED"
      ? "border-emerald-500/40"
      : cond.status === "NOT_SATISFIED"
        ? "border-rose-500/40"
        : "border-amber-500/40";

  return (
    <div className={`rounded-xl border bg-card p-4 ${cardTone}`}>
      {/* رأس البطاقة */}
      <div className="flex flex-wrap items-center gap-1.5">
        <h5 className="me-auto text-sm font-semibold">
          {biLabel(FIELD_LABELS, cond.field, lang)}
        </h5>
        {cond.mandatory ? (
          <Badge className="bg-rose-600/15 text-rose-700 hover:bg-rose-600/15 dark:text-rose-400">
            {t("إلزامي", "Mandatory")}
          </Badge>
        ) : (
          <Badge variant="secondary">{t("غير إلزامي", "Optional")}</Badge>
        )}
        <Badge
          variant="outline"
          className={
            cond.status === "SATISFIED"
              ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
              : cond.status === "NOT_SATISFIED"
                ? "border-rose-500/40 text-rose-700 dark:text-rose-400"
                : "border-amber-500/40 text-amber-700 dark:text-amber-400"
          }
        >
          {biLabel(STATUS_LABELS, cond.status, lang)}
        </Badge>
        {isAmbiguous ? (
          <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
            {t("صياغة غامضة", "Ambiguous")}
          </Badge>
        ) : null}
        {cond.unresolvedReason && !isAmbiguous ? (
          <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
            {biLabel(UNRESOLVED_REASON_LABELS, cond.unresolvedReason, lang)}
          </Badge>
        ) : null}
      </div>

      {/* المتوقع / قيمة ملفك */}
      <div className="mt-2.5 space-y-1.5 text-sm">
        <p>
          <span className="font-medium text-muted-foreground">{t("المتوقع:", "Expected:")}</span>{" "}
          {cond.expected}
        </p>
        <p>
          <span className="font-medium text-muted-foreground">{t("قيمة ملفك:", "Your value:")}</span>{" "}
          {cond.actual}
        </p>
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
          <Badge
            variant="outline"
            className={
              evState === "ok"
                ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                : evState === "missing"
                  ? "border-rose-500/50 text-rose-700 dark:text-rose-400"
                  : "border-amber-500/50 text-amber-700 dark:text-amber-400"
            }
          >
            {evState === "ok" ? <ShieldCheck className="h-3 w-3" aria-hidden="true" /> : null}
            {biLabel(EVIDENCE_STATE_LABELS, evState, lang)}
          </Badge>
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
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t(
              "لا دليل موثّق لهذا الشرط — عُلم ناقصًا.",
              "No documented evidence for this condition — flagged as missing.",
            )}
          </p>
        )}
      </div>
    </div>
  );
}

// ————— عامل ملاءمة واحد (شريط + وزن + تفسير) —————

function FactorRow({ factor }: { factor: FitFactor }) {
  const { t, lang } = useI18n();
  const ratio = factor.weight > 0 ? Math.min(1, Math.max(0, factor.score / factor.weight)) : 0;
  const tone =
    ratio >= 0.8
      ? "bg-emerald-600 dark:bg-emerald-500"
      : ratio >= 0.5
        ? "bg-amber-500"
        : "bg-rose-500";
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{lang === "ar" ? factor.labelAr : factor.labelEn ?? factor.key}</p>
        <p className="shrink-0 text-xs font-bold text-muted-foreground" dir="ltr">
          {factor.score}/{factor.weight}
          <span className="ms-1 font-normal">
            ({t("الوزن", "weight")} {factor.weight})
          </span>
        </p>
      </div>
      <div
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border"
        role="meter"
        aria-valuenow={factor.score}
        aria-valuemin={0}
        aria-valuemax={factor.weight}
        aria-label={factor.labelAr}
      >
        <div
          className={`h-full rounded-full transition-all ${tone}`}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{lang === "ar" ? factor.detail : factor.detailEn ?? "This factor is calculated from the available profile and opportunity data."}</p>
    </div>
  );
}

// ————— بطاقة مطابقة واحدة —————

function MatchCard({
  m,
  expanded,
  onToggle,
  tracked,
  trackPending,
  onTrack,
}: {
  m: MatchItem;
  expanded: boolean;
  onToggle: () => void;
  tracked: boolean;
  trackPending: boolean;
  onTrack: () => void;
}) {
  const { t, lang } = useI18n();
  const panelId = `why-${m.opportunity.id}`;
  const amounts = m.opportunity.amounts;
  const rel = relativeDays(m.opportunity.deadline, lang);

  return (
    <Card className="relative overflow-hidden">
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 start-0 w-1.5 ${
          m.judgment === "ELIGIBLE"
            ? "bg-emerald-500"
            : m.judgment === "UNCERTAIN"
              ? "bg-amber-500"
              : "bg-rose-500"
        }`}
      />
      <CardContent className="p-4 ps-5 sm:p-5 sm:ps-6">
        {/* رأس البطاقة */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <h3 className="font-semibold leading-snug">{m.opportunity.title}</h3>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{m.opportunity.orgName}</span>
              </span>
              <Badge variant="secondary" className="bg-emerald-600/12 text-emerald-700 dark:text-emerald-400">
                {biLabel(OPP_TYPE_LABELS, m.opportunity.type, lang)}
              </Badge>
              <Badge variant="outline">{biLabel(GEOGRAPHY_LABELS, m.opportunity.geography, lang)}</Badge>
            </p>
          </div>
          <JudgmentBadge judgment={m.judgment} />
        </div>

        {/* ملخص الحكم */}
        <p className="mt-3 text-sm leading-relaxed">{lang === "ar" ? m.summary : m.summaryEn ?? (m.judgment === "ELIGIBLE" ? "Mandatory criteria appear satisfied under the current rules. Verify the official source before applying." : m.judgment === "NOT_ELIGIBLE" ? "At least one mandatory criterion is documented as unmet. Review the criterion and official source below." : "Eligibility is not yet confirmed. Review missing profile details and evidence below.")}</p>

        {/* الملاءمة + المبلغ + الموعد */}
        <div className="mt-3 space-y-2">
          {m.fit ? (
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-xs font-medium text-muted-foreground">
                {t("الملاءمة", "Fit")}
              </span>
              <div className="min-w-0 flex-1">
                <ScoreBar score={m.fit.total} max={100} />
              </div>
              <span className="shrink-0 text-xs font-bold" dir="ltr">
                {m.fit.total}/100
              </span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t(
                "الملاءمة لا تُحسب عند عدم الأهلية — راجع أسباب الرفض أدناه.",
                "Fit is not computed when not eligible — see the rejection reasons below.",
              )}
            </p>
          )}
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium text-primary">
              {amountText(
                amounts.min,
                amounts.max,
                amounts.currency,
                lang,
                t("من", "From"),
                t("From", "From"),
                t("حتى", "Up to"),
                t("Up to", "Up to"),
                t("المبلغ غير محدد", "Amount unspecified"),
                t("Amount unspecified", "Amount unspecified"),
              )}
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
              {m.opportunity.deadline
                ? `${formatDate(m.opportunity.deadline, lang)}${rel ? ` · ${rel}` : ""}`
                : t("بلا موعد نهائي", "No deadline")}
            </span>
          </p>
        </div>

        {/* زر التوسعة */}
        <Button
          variant="outline"
          className="mt-3 h-11 gap-1.5"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
        >
          <HelpCircle className="h-4 w-4" aria-hidden="true" />
          {expanded ? t("إخفاء التفسير", "Hide explanation") : t("لماذا؟", "Why?")}
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </Button>

        {/* التفسير الموسّع */}
        {expanded ? (
          <motion.div
            id={panelId}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="mt-4 space-y-5 rounded-xl border bg-muted/30 p-4"
          >
            {/* الشروط */}
            <section aria-label={t("الشروط بتفصيلها", "Conditions in detail")}>
              <h4 className="mb-2 text-sm font-semibold">
                {t("الشروط", "Conditions")} ({m.conditions.length})
              </h4>
              {m.conditions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("لا شروط منظّمة لهذه الفرصة.", "No structured conditions for this opportunity.")}
                </p>
              ) : (
                <div className={`space-y-2.5 ${SCROLLABLE_LIST}`}>
                  {m.conditions.map((cond, i) => (
                    <MatchConditionCard key={`${cond.field}-${cond.op}-${i}`} cond={cond} />
                  ))}
                </div>
              )}
            </section>

            {/* عوامل الملاءمة */}
            {m.fit && m.fit.factors.length > 0 ? (
              <section aria-label={t("عوامل الملاءمة", "Fit factors")}>
                <h4 className="mb-2 text-sm font-semibold">
                  {t("عوامل الملاءمة", "Fit factors")} ({m.fit.total}/100)
                </h4>
                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                  {m.fit.factors.map((f) => (
                    <FactorRow key={f.key} factor={f} />
                  ))}
                </div>
              </section>
            ) : null}

            {/* الأسباب */}
            {m.blockingReasons.length > 0 || m.uncertainReasons.length > 0 ? (
              <section aria-label={t("أسباب الحكم", "Verdict reasons")}>
                <h4 className="mb-2 text-sm font-semibold">{t("أسباب الحكم", "Verdict reasons")}</h4>
                <div className="space-y-3">
                  {m.blockingReasons.length > 0 ? (
                    <ul className="space-y-1.5 rounded-lg border border-rose-500/35 bg-rose-500/5 p-3">
                      {(lang === "ar" ? m.blockingReasons : m.blockingReasonsEn ?? m.blockingReasons.map(() => "A mandatory documented criterion is not met. Review the criteria and official-source evidence below.")).map((r, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm leading-relaxed">
                          <XCircle
                            className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
                            aria-hidden="true"
                          />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {m.uncertainReasons.length > 0 ? (
                    <ul className="space-y-1.5 rounded-lg border border-amber-500/35 bg-amber-500/5 p-3">
                      {(lang === "ar" ? m.uncertainReasons : m.uncertainReasonsEn ?? m.uncertainReasons.map(() => "Eligibility cannot be confirmed yet. Check the required profile data and supporting evidence.")).map((r, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm leading-relaxed">
                          <AlertTriangle
                            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                            aria-hidden="true"
                          />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </section>
            ) : null}

            {/* الموثوقية مصغرة */}
            <section aria-label={t("موثوقية الفرصة", "Opportunity reliability")}>
              <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                {t("موثوقية الفرصة", "Opportunity reliability")}
              </h4>
              <ReliabilityMeter
                total={m.reliability.total}
                level={m.reliability.level}
                warningAr={m.reliability.warningAr}
                warningEn={m.reliability.warningEn}
              />
              {m.reliability.warningAr ? (
                <p
                  className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs leading-relaxed text-amber-800 dark:text-amber-300"
                  role="status"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{lang === "ar" ? m.reliability.warningAr : m.reliability.warningEn ?? "The source is old or has weak supporting evidence. Verify it before relying on this assessment."}</span>
                </p>
              ) : null}
            </section>

            {/* الإجراءات */}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {m.opportunity.applicationUrl ? (
                <Button variant="outline" className="h-11 gap-1.5" asChild>
                  <a href={m.opportunity.applicationUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    {t("فتح صفحة التقديم", "Open application page")}
                  </a>
                </Button>
              ) : null}
              <Button
                className="h-11 gap-1.5"
                disabled={tracked || trackPending}
                onClick={onTrack}
              >
                {trackPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : tracked ? (
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Bell className="h-4 w-4" aria-hidden="true" />
                )}
                {tracked
                  ? t("قيد التتبع", "Tracking")
                  : trackPending
                    ? t("جارٍ الإضافة…", "Adding…")
                    : t("تتبّع هذه الفرصة", "Track this opportunity")}
              </Button>
            </div>
          </motion.div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ————— المكون الرئيسي —————

export default function MatchesView({ onNavigate }: ViewProps) {
  const { t, lang } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noProfile, setNoProfile] = useState(false);
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const [trackingIds, setTrackingIds] = useState<ReadonlySet<string>>(new Set());
  const [trackPending, setTrackPending] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setNoProfile(false);
    api
      .get<MatchItem[]>("/matches")
      .then((ms) => setMatches(Array.isArray(ms) ? ms : []))
      .catch((e) => {
        const message =
          e instanceof Error && e.message.trim() !== ""
            ? e.message.trim()
            : t("خطأ غير متوقع", "Unexpected error");
        // NO_PROFILE: ملف الشركة غير موجود — حالة خاصة بدعوة لإنشاء الملف
        if (message.includes("ملف الشركة") || message.includes("NO_PROFILE")) {
          setNoProfile(true);
        } else {
          setError(message);
          toastError(e, t, "تعذّر تحميل المطابقات", "Failed to load your matches");
        }
      })
      .finally(() => setLoading(false));
    // t ثابت الدلالة — لا نعيد الجلب عند تبديل اللغة
  }, []);

  useEffect(() => {
    load();
  }, [load, nonce]);

  // حالة التتبّع الحالية (لترميم الأزرار)
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
      .catch(() => undefined); // صامت: الأخطاء تظهر عند التتبّع نفسه
  }, []);

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
        setTrackingIds((prev) => new Set(prev).add(oppId));
        toast.info(t("أنت تتابع هذه الفرصة بالفعل", "You already track this opportunity"));
      } else {
        toastError(e, t, "تعذّر تتبّع الفرصة", "Failed to track the opportunity");
      }
    } finally {
      setTrackPending(null);
    }
  }

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // التجميع في ثلاثة أقسام — داخل كل قسم الملاءمة تنازليًا (المستقر)
  const groups = useMemo(() => {
    const byFitDesc = (a: MatchItem, b: MatchItem): number => {
      const fa = a.fit && typeof a.fit.total === "number" ? a.fit.total : -1;
      const fb = b.fit && typeof b.fit.total === "number" ? b.fit.total : -1;
      return fb - fa;
    };
    return {
      eligible: matches.filter((m) => m.judgment === "ELIGIBLE").sort(byFitDesc),
      uncertain: matches.filter((m) => m.judgment === "UNCERTAIN").sort(byFitDesc),
      notEligible: matches.filter((m) => m.judgment === "NOT_ELIGIBLE").sort(byFitDesc),
    };
  }, [matches]);

  const sections: Array<{
    key: string;
    judgment: Judgment;
    tone: {
      panel: string;
      iconWrap: string;
      countBadge: string;
      icon: typeof CheckCircle2;
    };
    emptyText: string;
    items: MatchItem[];
  }> = [
    {
      key: "eligible",
      judgment: "ELIGIBLE",
      tone: {
        panel: "border-emerald-600/25 bg-emerald-500/5",
        iconWrap: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400",
        countBadge: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
        icon: CheckCircle2,
      },
      emptyText: t(
        "لا فرص مؤهلة بعد — أكمل بيانات ملفك وارفع عرضك التقديمي لرفع فرصك.",
        "No eligible opportunities yet — complete your profile and upload your pitch deck to improve your chances.",
      ),
      items: groups.eligible,
    },
    {
      key: "uncertain",
      judgment: "UNCERTAIN",
      tone: {
        panel: "border-amber-500/30 bg-amber-500/5",
        iconWrap: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        countBadge: "border-amber-500/40 text-amber-700 dark:text-amber-400",
        icon: AlertTriangle,
      },
      emptyText: t(
        "لا أحكام غير محسومة — كل الشروط الإلزامية إما مستوفاة أو مثبتة الرفض.",
        "No uncertain verdicts — every mandatory condition is either satisfied or conclusively rejected.",
      ),
      items: groups.uncertain,
    },
    {
      key: "not-eligible",
      judgment: "NOT_ELIGIBLE",
      tone: {
        panel: "border-rose-500/25 bg-rose-500/5",
        iconWrap: "bg-rose-600/15 text-rose-700 dark:text-rose-400",
        countBadge: "border-rose-500/40 text-rose-700 dark:text-rose-400",
        icon: XCircle,
      },
      emptyText: t(
        "لا فرص مستبعدة — لا شرط إلزامي مثبت الرفض ضدك حاليًّا.",
        "No excluded opportunities — no mandatory condition conclusively rejects you right now.",
      ),
      items: groups.notEligible,
    },
  ];

  return (
    <div className="space-y-6">
      {/* ————— شريط الملخص + محاكي ماذا لو ————— */}
      <section
        aria-label={t("ملخص الأحكام", "Verdicts summary")}
        className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/30 p-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          {sections.map((s) => (
            <Badge
              key={s.key}
              variant="outline"
              className={`h-9 gap-1.5 px-3 text-sm ${s.tone.countBadge}`}
              aria-label={t(
                `${biLabel(JUDGMENT_LABELS, s.judgment, lang)}: ${s.items.length}`,
                `${biLabel(JUDGMENT_LABELS, s.judgment, lang)}: ${s.items.length}`,
              )}
            >
              <s.tone.icon className="h-4 w-4" aria-hidden="true" />
              {biLabel(JUDGMENT_LABELS, s.judgment, lang)}
              <span className="font-bold">{s.items.length}</span>
            </Badge>
          ))}
        </div>
        <Button
          variant="outline"
          className="ms-auto h-11 gap-1.5"
          onClick={() => onNavigate("whatif")}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          {t("جرّب محاكي «ماذا لو»", "Try the what-if simulator")}
        </Button>
      </section>

      {/* ————— المحتوى ————— */}
      {loading ? (
        <div className="space-y-4" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      ) : noProfile ? (
        <EmptyState
          iconAr="∅"
          title={t("ملف شركتك غير موجود", "Your company profile is missing")}
          hintAr={t(
            "الأحكام تُبنى على ملف شركتك — أنشئ الملف وأكمل حقوله أولًا، ثم عُد لعرض المطابقات.",
            "Verdicts are built on your company profile — create it and fill its fields first, then come back to your matches.",
          )}
          action={
            <Button className="h-11" onClick={() => onNavigate("profile")}>
              {t("أنشئ/أكمل ملف الشركة", "Create/complete company profile")}
            </Button>
          }
        />
      ) : error !== null ? (
        <EmptyState
          iconAr="!"
          title={t("تعذّر تحميل المطابقات", "Failed to load your matches")}
          hintAr={error}
          action={
            <Button variant="outline" className="h-11 gap-1.5" onClick={() => setNonce((n) => n + 1)}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {t("إعادة المحاولة", "Retry")}
            </Button>
          }
        />
      ) : matches.length === 0 ? (
        <EmptyState
          iconAr="∅"
          title={t("لا مطابقات حاليًّا", "No matches yet")}
          hintAr={t(
            "لا توجد فرص منشورة لتقييمها ضد ملفك حتى الآن — عُد لاحقًا أو تصفّح الفرص المتاحة.",
            "There are no published opportunities to evaluate against your profile yet — check back later or browse available opportunities.",
          )}
          action={
            <Button variant="outline" className="h-11 gap-1.5" onClick={() => setNonce((n) => n + 1)}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {t("تحديث", "Refresh")}
            </Button>
          }
        />
      ) : (
        sections.map((s) => (
          <section
            key={s.key}
            aria-labelledby={`sec-${s.key}`}
            className={`rounded-2xl border p-4 sm:p-5 ${s.tone.panel}`}
          >
            <div className="mb-3 flex flex-wrap items-center gap-2.5">
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-lg ${s.tone.iconWrap}`}
                aria-hidden="true"
              >
                <s.tone.icon className="h-5 w-5" />
              </span>
              <h2 id={`sec-${s.key}`} className="text-lg font-bold">
                {biLabel(JUDGMENT_LABELS, s.judgment, lang)}
              </h2>
              <Badge variant="outline" className={`font-bold ${s.tone.countBadge}`}>
                {s.items.length}
              </Badge>
              {s.judgment !== "NOT_ELIGIBLE" ? (
                <span className="text-xs text-muted-foreground">
                  {t("مرتّبة بالملاءمة تنازليًّا", "Sorted by fit, descending")}
                </span>
              ) : null}
            </div>

            {s.items.length === 0 ? (
              <p className="rounded-xl border border-dashed bg-card/60 p-4 text-sm leading-relaxed text-muted-foreground">
                {s.emptyText}
              </p>
            ) : (
              <div className="space-y-4">
                {s.items.map((m) => (
                  <MatchCard
                    key={m.opportunity.id}
                    m={m}
                    expanded={expandedIds.has(m.opportunity.id)}
                    onToggle={() => toggleExpanded(m.opportunity.id)}
                    tracked={trackingIds.has(m.opportunity.id)}
                    trackPending={trackPending === m.opportunity.id}
                    onTrack={() => trackOpportunity(m.opportunity.id)}
                  />
                ))}
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}
