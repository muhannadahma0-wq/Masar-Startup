"use client";
/**
 * Masar — مكونات عرض مشتركة (T15) تستوردها شاشات T16–T18
 * ---------------------------------------------------------------------------
 * التصديرات (التوقيعات ملزِمة):
 *   JudgmentBadge({ judgment })            — شارة الحكم الثلاثي بألوان العقد
 *   ReliabilityMeter({ total, level, warningAr }) — شريط موثوقية 0–100 + تحذير عند low
 *   ScoreBar({ score, max, labelAr })      — شريط ملاءمة 0–100
 *   EmptyState({ iconAr, title, hintAr, action }) — حالة فراغ
 *   StatCard({ labelAr, value, sub })      — بطاقة إحصاء مضغوطة
 *
 * قواعد الألوان (§15): ELIGIBLE أخضر emerald، NOT_ELIGIBLE أحمر rose،
 * UNCERTAIN كهرماني amber؛ الموثوقية: ≥80 أخضر، 50–79 كهرماني، <50 أحمر.
 * الأشرطة تعتمد width (وليس translateX) لتعمل بلا خلل في RTL.
 */

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  XCircle,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useI18n } from "./i18n";

type IconType = React.ComponentType<{ className?: string }>;

/* ————————————————— JudgmentBadge ————————————————— */

export type Judgment = "ELIGIBLE" | "NOT_ELIGIBLE" | "UNCERTAIN";

const JUDGMENT_CONFIG: Record<
  Judgment,
  { classes: string; icon: IconType; ar: string; en: string }
> = {
  ELIGIBLE: {
    classes:
      "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
    icon: CheckCircle2,
    ar: "مؤهل",
    en: "Eligible",
  },
  NOT_ELIGIBLE: {
    classes:
      "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300",
    icon: XCircle,
    ar: "غير مؤهل",
    en: "Not eligible",
  },
  UNCERTAIN: {
    classes:
      "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
    icon: HelpCircle,
    ar: "غير محسوم",
    en: "Uncertain",
  },
};

export function JudgmentBadge({
  judgment,
}: {
  judgment: "ELIGIBLE" | "NOT_ELIGIBLE" | "UNCERTAIN";
}): React.JSX.Element {
  const { t } = useI18n();
  const cfg = JUDGMENT_CONFIG[judgment];
  const Icon = cfg.icon;
  return (
    <span
      role="status"
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
        cfg.classes,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {t(cfg.ar, cfg.en)}
    </span>
  );
}

/* ————————————————— ReliabilityMeter ————————————————— */

export type ReliabilityLevel = "high" | "medium" | "low";

const RELIABILITY_CONFIG: Record<
  ReliabilityLevel,
  { bar: string; icon: string; ar: string; en: string }
> = {
  high: {
    bar: "bg-emerald-600 dark:bg-emerald-500",
    icon: "text-emerald-600 dark:text-emerald-400",
    ar: "موثوقية عالية",
    en: "High reliability",
  },
  medium: {
    bar: "bg-amber-500 dark:bg-amber-400",
    icon: "text-amber-600 dark:text-amber-400",
    ar: "موثوقية متوسطة",
    en: "Medium reliability",
  },
  low: {
    bar: "bg-rose-600 dark:bg-rose-500",
    icon: "text-rose-600 dark:text-rose-400",
    ar: "موثوقية منخفضة",
    en: "Low reliability",
  },
};

const DEFAULT_LOW_WARNING_AR =
  "الموثوقية منخفضة — تحقّق من المصدر بنفسك قبل الاعتماد على هذا الحكم.";

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

export function ReliabilityMeter({
  total,
  level,
  warningAr,
  warningEn,
}: {
  total: number;
  level: "high" | "medium" | "low";
  warningAr?: string;
  warningEn?: string;
}): React.JSX.Element {
  const { t, lang } = useI18n();
  const pct = clampPercent(total);
  const cfg = RELIABILITY_CONFIG[level];
  const label = t(cfg.ar, cfg.en);
  const warningText = lang === "ar"
    ? warningAr?.trim() || DEFAULT_LOW_WARNING_AR
    : warningEn?.trim() || "The source is old or has weak supporting evidence. Verify it before relying on this assessment.";

  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          {label}
          {level === "low" ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    cfg.icon,
                  )}
                  aria-label={t("تحذير موثوقية", "Reliability warning")}
                >
                  <AlertTriangle className="size-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-64 text-right leading-relaxed">
                <p>{warningText}</p>
              </TooltipContent>
            </Tooltip>
          ) : null}
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {lang === "ar" ? `${pct}٪` : `${pct}%`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={label}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        {/* width وليس translateX — يعمل في RTL وLTR على السواء */}
        <div
          className={cn("h-full rounded-full transition-[width]", cfg.bar)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ————————————————— ScoreBar ————————————————— */

export function ScoreBar({
  score,
  max,
  labelAr,
}: {
  score: number;
  max: number;
  labelAr?: string;
}): React.JSX.Element {
  const { t, lang } = useI18n();
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const pct = clampPercent((score / safeMax) * 100);
  const shownScore = Number.isFinite(score) ? Math.round(score) : 0;

  return (
    <div className="w-full">
      {labelAr ? (
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-foreground">{labelAr}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {shownScore}
            {lang === "ar" ? "٪" : "%"}
          </span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={
          labelAr ?? t("درجة الملاءمة", "Fit score")
        }
        className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ————————————————— EmptyState ————————————————— */

export function EmptyState({
  iconAr,
  title,
  hintAr,
  action,
}: {
  iconAr: string;
  title: string;
  hintAr?: string;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card/60 px-6 py-10 text-center">
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-full bg-muted text-2xl leading-none select-none"
      >
        {iconAr}
      </span>
      <div className="max-w-sm">
        <p className="font-semibold text-foreground">{title}</p>
        {hintAr ? (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {hintAr}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/* ————————————————— StatCard ————————————————— */

export function StatCard({
  labelAr,
  value,
  sub,
}: {
  labelAr: string;
  value: React.ReactNode;
  sub?: string;
}): React.JSX.Element {
  return (
    <Card className="gap-2 py-4">
      <CardContent className="px-4">
        <p className="text-xs font-medium text-muted-foreground">{labelAr}</p>
        <div className="mt-1 text-2xl font-semibold leading-none tabular-nums text-foreground">
          {value}
        </div>
        {sub ? (
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {sub}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
