"use client";

/**
 * Masar — T17: WhatIfView — محاكي «ماذا لو»
 * ---------------------------------------------------------------------------
 *  - نموذج تعديل مؤقت (مجموعة فرعية: إقامة المؤسس، بلد التسجيل، الوضع القانوني،
 *    المرحلة، المبلغ المطلوب، القطاعات) مبدئيًا بقيم الملف الحالية (GET /profile).
 *  - «شغّل المحاكاة» → POST /matches/what-if:
 *      fields: الحقول الستة (المصدر "manual" الوهمي «ماذا لو»)
 *      founderOverrides: المؤسسون الحاليون مع استبدال إقامتهم جميعًا بالإقامة
 *      المحاكاة — لأن المحرك يقرأ founder.region من سجل المؤسسين أولًا (§7).
 *  - العرض: ملخص أعلى (عدد الأحكام قبل/بعد لكل نوع — «قبل» يُحسب من «بعد»
 *    ومصفوفة changed رياضيًا بلا طلب إضافي) + قائمة الفرص التي تغيّر حكمها
 *    (العنوان، القديم → الجديد بسهم وشارات ملونة، سبب التغيير من summary الجديد)
 *    + بقية الفرص مجمّعة بعدد فقط.
 *  - توضيح بارز: «محاكاة في الذاكرة — لا يُحفظ شيء في ملفك».
 *  - «اعتمد هذه القيم فعليًا» → onNavigate("profile", { whatIf:{fields} })
 *    (نموذج الملف يُعبَّأ بها للمراجعة قبل الحفظ).
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  EyeOff,
  FlaskConical,
  Loader2,
  LogIn,
  MapPin,
  Play,
  RefreshCw,
  Sparkles,
  Users,
} from "lucide-react";

import { api } from "@/lib/api-client";
import { useI18n, formatDate } from "@/components/app/i18n";
import type { ViewProps } from "@/components/app/types";
import { COUNTRY_KEYS, LEGAL_STATUS_VALUES, REGION_VALUES, SECTOR_KEYS, STAGE_KEYS } from "@/lib/core/types";
import type { Judgment } from "@/lib/core/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import {
  COUNTRY_LABELS,
  DirArrow,
  FieldShell,
  JUDGMENT_LABELS,
  JudgmentBadge,
  LEGAL_STATUS_LABELS,
  REGION_LABELS,
  SCROLL_TW,
  SECTOR_LABELS,
  STAGE_LABELS,
  labelOf,
  type CompactOpportunity,
  type ProfileData,
  type WhatIfResponse,
  type WhatIfTransferField,
} from "./ProfileView";

// —————————————————————————————— منطق المحاكاة ——————————————————————————————

interface SimDraft {
  founderRegion: string;
  registrationCountry: string;
  legalStatus: string;
  stage: string;
  askAmountUSD: string;
  sectors: string[];
}

function storedValue(p: ProfileData, key: string): unknown {
  const f = p.fields.find((x) => x.field === key);
  return f && f.value !== null && f.value !== undefined ? f.value : null;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** القيم المبدئية من الملف الحالي (إقامة الأساسي من سجل المؤسسين أولًا). */
function initSim(p: ProfileData): SimDraft {
  const primary = p.founders.find((f) => f.isPrimary) ?? p.founders[0];
  const ask = storedValue(p, "company.askAmountUSD");
  return {
    founderRegion: primary?.region ?? asString(storedValue(p, "founder.region")),
    registrationCountry: asString(storedValue(p, "company.registrationCountry")),
    legalStatus: asString(storedValue(p, "company.legalStatus")),
    stage: asString(storedValue(p, "company.stage")),
    askAmountUSD: typeof ask === "number" && Number.isFinite(ask) ? String(ask) : asString(ask),
    sectors: asStringArray(storedValue(p, "company.sectors")),
  };
}

function parseLoose(s: string): number | null | "invalid" {
  const v = s.trim();
  if (v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return n;
}

function arrayEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
}

interface SimSummary {
  matches: WhatIfResponse["matches"];
  changed: WhatIfResponse["changed"];
  before: Record<Judgment, number>;
  after: Record<Judgment, number>;
  unchanged: Record<Judgment, number>;
}

/** «قبل» = «بعد» + مصفوفة changed (قبل(x) = بعد(x) + خرج من x − دخل إلى x). */
function summarize(data: WhatIfResponse): SimSummary {
  const after: Record<Judgment, number> = { ELIGIBLE: 0, NOT_ELIGIBLE: 0, UNCERTAIN: 0 };
  for (const m of data.matches) after[m.judgment] += 1;
  const before: Record<Judgment, number> = { ...after };
  for (const c of data.changed) {
    before[c.oldJudgment] += 1;
    before[c.newJudgment] -= 1;
  }
  const changedIds = new Set(data.changed.map((c) => c.opportunityId));
  const unchanged: Record<Judgment, number> = { ELIGIBLE: 0, NOT_ELIGIBLE: 0, UNCERTAIN: 0 };
  for (const m of data.matches) {
    if (!changedIds.has(m.opportunity.id)) unchanged[m.judgment] += 1;
  }
  return { matches: data.matches, changed: data.changed, before, after, unchanged };
}

/** بناء حقول المحاكاة الستة (للطلب ولنقل القيم إلى نموذج الملف). */
function buildSimFields(sim: SimDraft): WhatIfTransferField[] {
  const ask = parseLoose(sim.askAmountUSD);
  return [
    { field: "founder.region", value: sim.founderRegion === "" ? null : sim.founderRegion },
    {
      field: "company.registrationCountry",
      value: sim.registrationCountry === "" ? null : sim.registrationCountry,
    },
    { field: "company.legalStatus", value: sim.legalStatus === "" ? null : sim.legalStatus },
    { field: "company.stage", value: sim.stage === "" ? null : sim.stage },
    { field: "company.askAmountUSD", value: ask === "invalid" ? null : ask },
    { field: "company.sectors", value: sim.sectors.length === 0 ? null : [...sim.sectors] },
  ];
}

const COUNTRY_SET = new Set<string>([...COUNTRY_KEYS, "none"]);

// —————————————————————————————— الشاشة ——————————————————————————————

const JUDGMENT_TONES: Record<Judgment, string> = {
  ELIGIBLE: "border-emerald-300/80 bg-emerald-50/60 dark:border-emerald-800/70 dark:bg-emerald-950/40",
  NOT_ELIGIBLE: "border-rose-300/80 bg-rose-50/60 dark:border-rose-800/70 dark:bg-rose-950/40",
  UNCERTAIN: "border-amber-300/80 bg-amber-50/60 dark:border-amber-700/70 dark:bg-amber-950/40",
};

const JUDGMENT_ORDER: Judgment[] = ["ELIGIBLE", "UNCERTAIN", "NOT_ELIGIBLE"];

export default function WhatIfView({ onNavigate }: ViewProps) {
  const { t, lang, dir } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string } | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [sim, setSim] = useState<SimDraft | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SimSummary | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [sectorsSkipped, setSectorsSkipped] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await api.get<{ user: { role: string } }>("/auth/me");
      const data = await api.get<{ profile: ProfileData }>("/profile");
      setProfile(data.profile);
      setSim(initSim(data.profile));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError({ message });
      setProfile(null);
      setSim(null);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runSimulation = useCallback(async () => {
    if (!profile || !sim) return;
    const ask = parseLoose(sim.askAmountUSD);
    if (ask === "invalid") {
      toast.error(
        t(
          "أدخل مبلغًا رقميًا غير سالب أو اتركه فارغًا (غير مذكور)",
          "Enter a non-negative number, or leave it empty (unspecified)",
        ),
      );
      return;
    }
    const allFields = buildSimFields(sim).map((f) => ({ ...f, source: "manual" as const }));
    // القطاعات تُرسل فقط إذا تغيّرت عن الملف — القيم غير المتغيّرة تُقرأ من نسخة
    // الملف في المحاكاة أصلًا (وتتجنب رفض مخطط الخادم الحالي لقيم المصفوفات).
    const profileSectors = asStringArray(storedValue(profile, "company.sectors"));
    const sectorsChanged = !arrayEqual(sim.sectors, profileSectors);
    const fields = sectorsChanged
      ? allFields
      : allFields.filter((f) => f.field !== "company.sectors");
    // المحرك يقرأ founder.region من سجل المؤسسين أولًا (§7) → نستبدل إقامة جميع
    // المؤسسين في نسخة الذاكرة كي تنعكس المحاكاة فعليًا.
    const founderOverrides =
      profile.founders.length > 0
        ? profile.founders.slice(0, 6).map((f) => ({
            name: (f.name ?? "").slice(0, 80) || undefined,
            region: sim.founderRegion === "" ? undefined : sim.founderRegion,
            nationality: f.nationality && COUNTRY_SET.has(f.nationality) ? f.nationality : undefined,
            isPrimary: f.isPrimary,
          }))
        : undefined;
    setRunning(true);
    setResultError(null);
    setSectorsSkipped(false);
    try {
      let data: WhatIfResponse;
      try {
        data = await api.post<WhatIfResponse>("/matches/what-if", {
          fields,
          ...(founderOverrides ? { founderOverrides } : {}),
        });
      } catch (firstErr) {
        // قيمة المصفوفة (القطاعات) يرفضها مخطط الخادم الحالي — أعد المحاولة بلا
        // قطاعات (تبقى من نسخة الملف) مع إشعار صادق؛ وإن صُحّح المخطط لاحقًا
        // يعمل المسار الكامل تلقائيًا.
        if (!sectorsChanged) throw firstErr;
        const withoutSectors = fields.filter((f) => f.field !== "company.sectors");
        data = await api.post<WhatIfResponse>("/matches/what-if", {
          fields: withoutSectors,
          ...(founderOverrides ? { founderOverrides } : {}),
        });
        setSectorsSkipped(true);
      }
      setResult(summarize(data));
      toast.success(
        t("انتهت المحاكاة — لم يُحفظ شيء في ملفك", "Simulation done — nothing was saved to your profile"),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setResultError(message);
      toast.error(message);
    } finally {
      setRunning(false);
    }
  }, [profile, sim, t]);

  const adoptValues = useCallback(() => {
    if (!sim) return;
    onNavigate("profile", { whatIf: { fields: buildSimFields(sim) } });
  }, [sim, onNavigate]);

  const resetSim = useCallback(() => {
    if (!profile) return;
    setSim(initSim(profile));
    setResult(null);
    setResultError(null);
    setSectorsSkipped(false);
  }, [profile]);

  const sectorOptions = SECTOR_KEYS.map((k) => ({ key: k, label: labelOf(SECTOR_LABELS, k, lang) }));
  const stageOptions = STAGE_KEYS.map((k) => ({ key: k, label: labelOf(STAGE_LABELS, k, lang) }));
  const regionOptions = REGION_VALUES.map((k) => ({ key: k, label: labelOf(REGION_LABELS, k, lang) }));
  const countryOptions = [
    ...COUNTRY_KEYS.map((k) => ({ key: k, label: labelOf(COUNTRY_LABELS, k, lang) })),
    { key: "none", label: t("غير مسجلة", "Not registered") },
  ];
  const legalOptions = LEGAL_STATUS_VALUES.map((k) => ({
    key: k,
    label: labelOf(LEGAL_STATUS_LABELS, k, lang),
  }));
  const unsetLabel = t("غير محدد", "Unspecified");

  const toaster = <Toaster richColors position="top-center" dir={dir} closeButton />;

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        {toaster}
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !profile || !sim) {
    return (
      <div className="flex flex-col gap-6">
        {toaster}
        <Card className="p-6" role="alert">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-300">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </span>
            <div className="flex-1">
              <CardTitle className="text-base">
                {t("تعذّر تحميل بيانات المحاكاة", "Failed to load simulation data")}
              </CardTitle>
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

  const askInvalid = parseLoose(sim.askAmountUSD) === "invalid";
  const matchById = (id: string) => (result ? result.matches.find((x) => x.opportunity.id === id) : undefined);

  return (
    <div className="flex flex-col gap-6">
      {toaster}

      {/* الترويسة */}
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold leading-tight">
          <FlaskConical className="size-6 text-primary" aria-hidden="true" />
          {t("محاكي «ماذا لو»", "What-if simulator")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "جرّب تغيير أهم حقول ملفك مؤقتًا وشاهد كيف تنقلب أحكام الأهلية — قبل أن تغيّر ملفك فعليًا",
            "Try changing your key profile fields temporarily and watch eligibility judgments flip — before touching your real profile",
          )}
        </p>
      </header>

      {/* التوضيح البارز: محاكاة في الذاكرة */}
      <Card className="border-amber-300/80 bg-amber-50/70 p-4 dark:border-amber-700/70 dark:bg-amber-950/40" role="note">
        <div className="flex items-start gap-3">
          <EyeOff className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
          <p className="text-sm font-semibold leading-relaxed text-amber-900 dark:text-amber-200">
            {t(
              "محاكاة في الذاكرة — لا يُحفظ شيء في ملفك",
              "In-memory simulation — nothing is saved to your profile",
            )}
          </p>
        </div>
      </Card>

      {/* نموذج المحاكاة */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {t("القيم المحاكاة (مبدئيًا من ملفك)", "Simulated values (initially from your profile)")}
          </CardTitle>
          <CardDescription className="text-xs leading-relaxed">
            {t(
              "تُطبَّق إقامة المؤسس على جميع المؤسسين في النسخة المحاكاة",
              "The founder residence applies to all founders in the simulated copy",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FieldShell
              label={t("إقامة المؤسس", "Founder residence")}
              htmlFor="wi-region"
              hint={t("تُطبَّق على جميع المؤسسين هنا", "Applied to all founders here")}
            >
              <Select
                value={sim.founderRegion === "" ? "unset" : sim.founderRegion}
                onValueChange={(v) =>
                  setSim((s) => (s ? { ...s, founderRegion: v === "unset" ? "" : v } : s))
                }
              >
                <SelectTrigger id="wi-region" className="h-11 w-full">
                  <SelectValue placeholder={t("اختر الإقامة", "Select residence")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">{unsetLabel}</SelectItem>
                  {regionOptions.map((o) => (
                    <SelectItem key={o.key} value={o.key}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldShell>

            <FieldShell label={t("بلد التسجيل", "Registration country")} htmlFor="wi-country">
              <Select
                value={sim.registrationCountry === "" ? "unset" : sim.registrationCountry}
                onValueChange={(v) =>
                  setSim((s) => (s ? { ...s, registrationCountry: v === "unset" ? "" : v } : s))
                }
              >
                <SelectTrigger id="wi-country" className="h-11 w-full">
                  <SelectValue placeholder={t("اختر البلد", "Select country")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">{unsetLabel}</SelectItem>
                  {countryOptions.map((o) => (
                    <SelectItem key={o.key} value={o.key}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldShell>

            <FieldShell label={t("الوضع القانوني", "Legal status")} htmlFor="wi-legal">
              <Select
                value={sim.legalStatus === "" ? "unset" : sim.legalStatus}
                onValueChange={(v) => setSim((s) => (s ? { ...s, legalStatus: v === "unset" ? "" : v } : s))}
              >
                <SelectTrigger id="wi-legal" className="h-11 w-full">
                  <SelectValue placeholder={t("اختر الوضع", "Select status")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">{unsetLabel}</SelectItem>
                  {legalOptions.map((o) => (
                    <SelectItem key={o.key} value={o.key}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldShell>

            <FieldShell label={t("المرحلة", "Stage")} htmlFor="wi-stage">
              <Select
                value={sim.stage === "" ? "unset" : sim.stage}
                onValueChange={(v) => setSim((s) => (s ? { ...s, stage: v === "unset" ? "" : v } : s))}
              >
                <SelectTrigger id="wi-stage" className="h-11 w-full">
                  <SelectValue placeholder={t("اختر المرحلة", "Select stage")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">{unsetLabel}</SelectItem>
                  {stageOptions.map((o) => (
                    <SelectItem key={o.key} value={o.key}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldShell>

            <FieldShell label={t("المبلغ المطلوب (دولار أمريكي)", "Funding ask (USD)")} htmlFor="wi-ask">
              <Input
                id="wi-ask"
                type="number"
                inputMode="decimal"
                min={0}
                className={cn("h-11", askInvalid && "border-destructive")}
                value={sim.askAmountUSD}
                onChange={(e) => setSim((s) => (s ? { ...s, askAmountUSD: e.target.value } : s))}
                placeholder={t("مثال: 50000", "e.g. 50000")}
                aria-invalid={askInvalid}
              />
            </FieldShell>

            <FieldShell
              label={t("القطاعات", "Sectors")}
              htmlFor="wi-sector"
              hint={
                sim.sectors.length > 1
                  ? t("قطاعات ملفك — أزلها أو اختر قطاعًا واحدًا بديلًا", "Your profile sectors — remove or replace with one")
                  : t("القطاع الأول", "Primary sector")
              }
            >
              <Select
                value={sim.sectors.length === 1 ? sim.sectors[0] : "unset-multi"}
                onValueChange={(v) => {
                  if (v === "unset-multi") return;
                  setSim((s) => (s ? { ...s, sectors: [v] } : s));
                }}
              >
                <SelectTrigger id="wi-sector" className="h-11 w-full">
                  <SelectValue placeholder={t("اختر القطاع الأول", "Select primary sector")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset-multi">
                    {sim.sectors.length > 1
                      ? t(`${sim.sectors.length} قطاعات من ملفك`, `${sim.sectors.length} sectors from your profile`)
                      : unsetLabel}
                  </SelectItem>
                  {sectorOptions.map((o) => (
                    <SelectItem key={o.key} value={o.key}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldShell>
          </div>

          {sim.sectors.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {sim.sectors.map((k) => (
                <Badge key={k} variant="outline" className="gap-1">
                  {labelOf(SECTOR_LABELS, k, lang)}
                  <button
                    type="button"
                    className="ms-1 rounded-sm px-1 text-muted-foreground hover:text-foreground"
                    aria-label={t(
                      `إزالة ${labelOf(SECTOR_LABELS, k, lang)}`,
                      `Remove ${labelOf(SECTOR_LABELS, k, lang)}`,
                    )}
                    onClick={() =>
                      setSim((s) => (s ? { ...s, sectors: s.sectors.filter((x) => x !== k) } : s))
                    }
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button className="h-11" onClick={() => void runSimulation()} disabled={running}>
              {running ? (
                <Loader2 className="me-2 size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="me-2 size-4" aria-hidden="true" />
              )}
              {t("شغّل المحاكاة", "Run simulation")}
            </Button>
            <Button variant="outline" className="h-11" onClick={resetSim} disabled={running}>
              <RefreshCw className="me-2 size-4" aria-hidden="true" />
              {t("إعادة قيم الملف", "Reset to profile values")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* النتائج */}
      {running ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : null}

      {resultError && !running ? (
        <Card className="p-4" role="alert">
          <div className="flex flex-wrap items-center gap-3">
            <AlertTriangle className="size-5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-sm leading-relaxed">{resultError}</p>
            <Button variant="outline" className="h-11" onClick={() => void runSimulation()}>
              {t("إعادة المحاولة", "Retry")}
            </Button>
          </div>
        </Card>
      ) : null}

      {result && !running ? (
        <section aria-label={t("نتائج المحاكاة", "Simulation results")} className="flex flex-col gap-4">
          {/* إشعار اقتصار المحاكاة عن القطاعات (قيد مخطط الخادم الحالي) */}
          {sectorsSkipped ? (
            <Card
              className="border-amber-300/70 bg-amber-50/60 p-3 dark:border-amber-700/60 dark:bg-amber-950/40"
              role="note"
            >
              <p className="text-sm leading-relaxed text-amber-900 dark:text-amber-200">
                {t(
                  "تعذّر تضمين تعديل القطاعات في هذه المحاكاة — استُخدمت قطاعات ملفك الحالية (قيد في مخطط واجهة الخادم الحالي).",
                  "Could not include the sector change in this simulation — your profile's current sectors were used (current server schema limitation).",
                )}
              </p>
            </Card>
          ) : null}

          {/* ملخص قبل/بعد لكل نوع */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {JUDGMENT_ORDER.map((j) => {
              const before = result.before[j];
              const after = result.after[j];
              const diff = after - before;
              return (
                <div key={j} className={cn("flex flex-col gap-1 rounded-lg border p-3", JUDGMENT_TONES[j])}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">{labelOf(JUDGMENT_LABELS, j, lang)}</span>
                    {diff !== 0 ? (
                      <Badge
                        className={cn(
                          "tabular-nums",
                          diff > 0
                            ? "border-transparent bg-emerald-600 text-white"
                            : "border-transparent bg-rose-600 text-white",
                        )}
                      >
                        {diff > 0 ? `+${diff}` : diff}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn("text-lg font-bold tabular-nums", diff === 0 && "text-muted-foreground")}
                    >
                      {before}
                    </span>
                    <DirArrow dir={dir} className="opacity-50" />
                    <span className="text-lg font-bold tabular-nums">{after}</span>
                  </div>
                  <span className="text-[11px] opacity-70">
                    {t("قبل ← بعد", "before → after")} · {t("إجمالي", "total")}: {result.matches.length}
                  </span>
                </div>
              );
            })}
          </div>

          {/* الفرص التي تغيّر حكمها */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {t("الفرص التي تغيّر حكمها", "Opportunities whose judgment changed")}
              </CardTitle>
              <CardDescription>
                {t(
                  `${result.changed.length} ${
                    result.changed.length === 1 ? "فرصة" : "فرص"
                  } — السبب من ملخص الحكم الجديد`,
                  `${result.changed.length} ${
                    result.changed.length === 1 ? "opportunity" : "opportunities"
                  } — reason taken from the new judgment summary`,
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {result.changed.length === 0 ? (
                <div className="flex min-h-20 items-center gap-3 rounded-lg border border-dashed bg-muted/30 p-4">
                  <Sparkles className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "لا فرص تغيّر حكمها بهذه القيم — الأحكام كما في ملفك الحالي",
                      "No judgment changes with these values — same as your current profile",
                    )}
                  </p>
                </div>
              ) : (
                <div className={cn("flex max-h-96 flex-col gap-3 pe-1", SCROLL_TW)}>
                  {result.changed.map((c) => {
                    const match = matchById(c.opportunityId);
                    const opp: CompactOpportunity | undefined = match?.opportunity;
                    return (
                      <div
                        key={c.opportunityId}
                        className="animate-in fade-in-50 slide-in-from-bottom-1 flex flex-col gap-2 rounded-lg border p-4 duration-300"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold leading-snug">{c.title}</h3>
                            {opp ? <p className="text-xs text-muted-foreground">{opp.orgName}</p> : null}
                          </div>
                          {opp?.deadline ? (
                            <Badge variant="outline" className="text-[11px]">
                              {t("الموعد", "Deadline")}: {formatDate(opp.deadline, lang)}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <JudgmentBadge judgment={c.oldJudgment} />
                          <DirArrow dir={dir} className="text-muted-foreground" />
                          <JudgmentBadge judgment={c.newJudgment} />
                          {match?.fit ? (
                            <Badge variant="secondary" className="ms-auto tabular-nums">
                              {t("الملاءمة بعد", "Fit after")}: {match.fit.total}/100
                            </Badge>
                          ) : null}
                        </div>
                        {match ? (
                          <p className="text-sm leading-relaxed text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {t("سبب الحكم الجديد", "New judgment reason")}:
                            </span>{" "}
                            {lang === "ar" ? match.summary : match.summaryEn ?? "Review the current criteria and evidence to understand this eligibility result."}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* بقية الفرص مجمّعة بعدد فقط */}
          <Card>
            <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
              <span className="text-sm font-semibold">
                {t("بقية الفرص بلا تغيير", "Remaining opportunities unchanged")}:
              </span>
              {JUDGMENT_ORDER.map((j) => (
                <span key={j} className="flex items-center gap-1.5 text-sm">
                  <JudgmentBadge judgment={j} />
                  <span className="font-semibold tabular-nums">{result.unchanged[j]}</span>
                </span>
              ))}
              <span className="w-full text-xs text-muted-foreground sm:w-auto">
                {t(
                  "تُعرض كاملة في «المطابقات» — هذه نسخة ذاكرة فقط",
                  "View them fully in Matches — this copy lives in memory only",
                )}
              </span>
            </CardContent>
          </Card>

          {/* اعتماد القيم فعليًا */}
          <Card className="border-emerald-300/70 bg-emerald-50/50 p-4 dark:border-emerald-800/70 dark:bg-emerald-950/30">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-relaxed text-emerald-900 dark:text-emerald-200">
                {t(
                  "رأيت الأثر؟ انقل هذه القيم إلى نموذج ملف الشركة للمراجعة والحفظ الفعلي.",
                  "Like the outcome? Carry these values into the profile form for review and actual saving.",
                )}
              </p>
              <Button className="h-11 shrink-0" onClick={adoptValues} disabled={askInvalid}>
                <Users className="me-2 size-4" aria-hidden="true" />
                {t("اعتمد هذه القيم فعليًا", "Adopt these values")}
              </Button>
            </div>
          </Card>
        </section>
      ) : null}

      {/* تلميح أولي قبل أول تشغيل */}
      {!result && !running && !resultError ? (
        <Card className="border-dashed p-4">
          <div className="flex min-h-16 items-center gap-3">
            <MapPin className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              {t(
                "عدّل القيم أعلاه ثم اضغط «شغّل المحاكاة» لترى الفرص التي ينقلب حكمها",
                "Adjust the values above, then hit “Run simulation” to see which judgments flip",
              )}
            </p>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
