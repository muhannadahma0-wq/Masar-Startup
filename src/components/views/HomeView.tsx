"use client";
/**
 * Masar — T16: HomeView — نظرة عامة (الوحدة الثانية: شاشة البداية)
 * =============================================================================
 * - ترحيب باسم المستخدم (GET /auth/me — الجلسة يديرها المنسّق في page.tsx).
 * - 4 بطاقات إحصاء (StatCard من badges المشتركة T15):
 *     1) فرص منشورة          ← GET /opportunities?take=1 (total)
 *     2) أحكامك مؤهل/غير محسوم ← GET /matches (عدّ الأحكام)
 *     3) طلبات نشطة           ← GET /applications (INTERESTED/PREPARING/SUBMITTED)
 *     4) إشعارات غير مقروءة   ← GET /notifications?unread=true
 * - بطاقة دعوة «ارفع عرضك لتحليله» → deck، وبطاقة «فحص سريع بلا حساب» → quickcheck.
 * - «كيف يحكم مسار؟» ثلاث خطوات بالأيقونات (توثيق → قواعد حتمية → تفسير بالأدلة).
 * القواعد: useI18n().t لكل نص، api من api-client، تحميل Skeleton، أخطاء toast sonner،
 * RTL-native بخصائص منطقية (ms-/me-) بلا تثبيت اتجاه، وأهداف لمس ≥ 44px.
 */

import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  FileSearch,
  Lightbulb,
  Scale,
  UploadCloud,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/app/badges";
import { useI18n } from "@/components/app/i18n";
import type { ViewProps } from "@/components/app/types";
import { api } from "@/lib/api-client";
import type { Judgment } from "@/lib/core/types";

// ————— أشكال الردود كما تُعيدها المسارات فعليًّا (T9/T10/T11/T14) —————

interface MeResponse {
  user: {
    id: string;
    email: string;
    name: string | null;
    role: "FOUNDER" | "REVIEWER" | "ADMIN";
    locale: string;
  };
}

interface OpportunityListResponse {
  items: unknown[];
  total: number;
}

interface MatchJudgmentItem {
  judgment: Judgment;
}

interface ApplicationsResponse {
  applications: Array<{ status: string }>;
}

interface NotificationsResponse {
  notifications: unknown[];
}

/** الطلبات «النشطة» في المتتبع (T14) */
const ACTIVE_APPLICATION_STATUSES: ReadonlySet<string> = new Set([
  "INTERESTED",
  "PREPARING",
  "SUBMITTED",
]);

/** خطأ موحّد: toast sonner برسالة الخادم إن وُجدت */
function toastError(
  e: unknown,
  t: (ar: string, en: string) => string,
  ar: string,
  en: string,
): void {
  const message = e instanceof Error && e.message.trim() !== "" ? e.message.trim() : "";
  toast.error(message !== "" ? `${t(ar, en)} — ${message}` : t(ar, en));
}

interface HomeStats {
  published: number | null;
  eligible: number | null;
  uncertain: number | null;
  activeApplications: number | null;
  unreadNotifications: number | null;
}

/** غلاف قابل للنقر حول بطاقة إحصاء (بلا اعتماد على onClick داخل StatCard) */
function StatTile({
  onClick,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="cursor-pointer rounded-xl outline-none transition-transform duration-150 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {children}
    </div>
  );
}

export default function HomeView({ onNavigate }: ViewProps) {
  const { t, lang } = useI18n();
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState<string>("");
  const [isFounder, setIsFounder] = useState(true);
  const [stats, setStats] = useState<HomeStats>({
    published: null,
    eligible: null,
    uncertain: null,
    activeApplications: null,
    unreadNotifications: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // الجلسة أولًا — /auth/me يُنشئ الملف lazily (T9) فتصبح /matches بعده متاحة
        const me = await api.get<MeResponse>("/auth/me");
        if (cancelled) return;
        const name = me.user.name && me.user.name.trim() !== "" ? me.user.name.trim() : me.user.email;
        setDisplayName(name);
        const founder = me.user.role === "FOUNDER";
        setIsFounder(founder);

        const tasks: Array<Promise<void>> = [];

        // 1) الفرص المنشورة — متاحة لكل مستخدم مسجَّل (T10)
        tasks.push(
          api
            .get<OpportunityListResponse>("/opportunities?take=1")
            .then((r) => {
              if (!cancelled) setStats((s) => ({ ...s, published: r.total }));
            })
            .catch((e) =>
              toastError(e, t, "تعذّر تحميل عدد الفرص المنشورة", "Failed to load published opportunities count"),
            ),
        );

        // 2) + 3) أحكام المطابقات والطلبات — FOUNDER فقط (T11/T14)
        if (founder) {
          tasks.push(
            api
              .get<MatchJudgmentItem[]>("/matches")
              .then((ms) => {
                if (cancelled) return;
                const eligible = ms.filter((m) => m.judgment === "ELIGIBLE").length;
                const uncertain = ms.filter((m) => m.judgment === "UNCERTAIN").length;
                setStats((s) => ({ ...s, eligible, uncertain }));
              })
              .catch((e) =>
                toastError(e, t, "تعذّر تحميل أحكام مطابقاتك", "Failed to load your match verdicts"),
              ),
          );
          tasks.push(
            api
              .get<ApplicationsResponse>("/applications")
              .then((r) => {
                if (cancelled) return;
                const active = r.applications.filter((a) =>
                  ACTIVE_APPLICATION_STATUSES.has(a.status),
                ).length;
                setStats((s) => ({ ...s, activeApplications: active }));
              })
              .catch((e) =>
                toastError(e, t, "تعذّر تحميل طلباتك", "Failed to load your applications"),
              ),
          );
        }

        // 4) الإشعارات غير المقروءة — لكل مستخدم مسجَّل (T14)
        tasks.push(
          api
            .get<NotificationsResponse>("/notifications?unread=true")
            .then((r) => {
              if (!cancelled) setStats((s) => ({ ...s, unreadNotifications: r.notifications.length }));
            })
            .catch((e) =>
              toastError(e, t, "تعذّر تحميل الإشعارات", "Failed to load notifications"),
            ),
        );

        await Promise.all(tasks.map((p) => p.catch(() => undefined)));
      } catch (e) {
        if (!cancelled) {
          toastError(e, t, "تعذّر تحميل بيانات الجلسة", "Failed to load session data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // t مقصود خارج قائمة الاعتماد: النصوص ثابتة الدلالة ولا نريد إعادة الجلب عند تبديل اللغة
  }, []);

  // ————— «كيف يحكم مسار؟» —————
  const howSteps = [
    {
      icon: FileSearch,
      title: t("نجمع الفرص ونوثّق شروطها", "We collect opportunities and document their conditions"),
      desc: t(
        "كل شرط في الفرصة يُقترن بدليل من مصدر الجهة: رابط صحيح، واقتباس نصي، وتاريخ آخر تحقق.",
        "Every condition is paired with evidence from the source: a valid link, a text quote, and the last verification date.",
      ),
    },
    {
      icon: Scale,
      title: t("نطبّق قواعد حتمية", "We apply deterministic rules"),
      desc: t(
        "مقارنة ملفك بشروط الفرصة بقواعد ثابتة معلنة — النموذج اللغوي لا يشارك في الحكم أبدًا، والقيمة الغائبة لا تُخمَّن.",
        "Your profile is compared against the conditions with fixed, published rules — the language model never takes part in the verdict, and missing values are never guessed.",
      ),
    },
    {
      icon: Lightbulb,
      title: t("نشرح الحكم بالأدلة", "We explain the verdict with evidence"),
      desc: t(
        "ثلاث قيم فقط: مؤهل، أو غير محسوم مع سببه ونقصه، أو غير مؤهل بسبب موثّق — بلا درجة إجمالية غامضة.",
        "Only three values: eligible, uncertain with its reason and gaps, or not eligible with a documented cause — no vague overall score.",
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* ————— الترحيب ————— */}
      <section aria-labelledby="home-welcome">
        <h1
          id="home-welcome"
          className="text-2xl font-bold tracking-tight sm:text-3xl"
        >
          {loading && displayName === "" ? (
            <Skeleton className="inline-block h-9 w-64 align-middle" />
          ) : (
            t(`أهلًا ${displayName} في «مسار»`, `Welcome, ${displayName}, to Masar`)
          )}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          {t(
            "فرص تمويل موثّقة، ومحرك أهلية يشرح حكمه بالأدلة: كل شرط برابطه واقتباسه وتاريخ آخر تحقق.",
            "Verified funding opportunities and an eligibility engine that explains every verdict with evidence: each condition with its link, quote, and last verification date.",
          )}
        </p>
      </section>

      {/* ————— بطاقات الإحصاء ————— */}
      <section
        aria-label={t("ملخص عام", "Overview")}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))
        ) : (
          <>
            <StatTile
              onClick={() => onNavigate("opportunities")}
              ariaLabel={t("تصفّح الفرص المنشورة", "Browse published opportunities")}
            >
              <StatCard
                labelAr={t("فرص منشورة", "Published opportunities")}
                value={stats.published ?? "—"}
                sub={t("موثّقة ومتاحة للتصفّح", "Verified and ready to browse")}
              />
            </StatTile>

            <StatTile
              onClick={() => onNavigate("matches")}
              ariaLabel={t("عرض مطابقات ملفك", "Open your profile matches")}
            >
              <StatCard
                labelAr={t("أحكامك (مؤهل / غير محسوم)", "Your verdicts (eligible / uncertain)")}
                value={
                  stats.eligible === null ? (
                    "—"
                  ) : (
                    <span className="flex items-baseline gap-2" dir={lang === "ar" ? "rtl" : "ltr"}>
                      <span className="text-emerald-600 dark:text-emerald-400">{stats.eligible}</span>
                      <span className="text-muted-foreground" aria-hidden="true">
                        /
                      </span>
                      <span className="text-amber-600 dark:text-amber-400">{stats.uncertain ?? 0}</span>
                    </span>
                  )
                }
                sub={
                  isFounder
                    ? t("اضغط لعرض التفسير الكامل للأحكام", "Click for the full verdict breakdown")
                    : t("متاح لحسابات المؤسسين", "Available for founder accounts")
                }
              />
            </StatTile>

            <StatTile
              onClick={() => onNavigate("tracker")}
              ariaLabel={t("عرض متتبع الطلبات", "Open the applications tracker")}
            >
              <StatCard
                labelAr={t("طلبات نشطة", "Active applications")}
                value={stats.activeApplications ?? "—"}
                sub={
                  isFounder
                    ? t("فرص تتابعها أو تجهّز لها", "Opportunities you track or prepare for")
                    : t("متاح لحسابات المؤسسين", "Available for founder accounts")
                }
              />
            </StatTile>

            <StatTile
              onClick={() => onNavigate("notifications")}
              ariaLabel={t("عرض الإشعارات", "Open notifications")}
            >
              <StatCard
                labelAr={t("إشعارات غير مقروءة", "Unread notifications")}
                value={stats.unreadNotifications ?? "—"}
                sub={t("تغييرات جوهرية في فرصك", "Substantive changes in your opportunities")}
              />
            </StatTile>
          </>
        )}
      </section>

      {/* ————— دعوتان: رفع العرض + الفحص السريع ————— */}
      <section
        className="grid grid-cols-1 gap-4 md:grid-cols-2"
        aria-label={t("خطوات مقترحة", "Suggested next steps")}
      >
        <motion.div
          whileHover={{ y: -3 }}
          transition={{ type: "spring", stiffness: 320, damping: 26 }}
          className="h-full"
        >
          <Card className="h-full overflow-hidden border-emerald-900/25 bg-gradient-to-br from-emerald-950 via-teal-900 to-emerald-800 text-emerald-50 dark:from-emerald-950/90 dark:via-teal-950/90 dark:to-emerald-900/90">
            <CardContent className="flex h-full flex-col gap-4 p-6">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100/15 text-emerald-100"
                aria-hidden="true"
              >
                <UploadCloud className="h-6 w-6" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-semibold leading-snug">
                  {t("ارفع عرضك لتحليله", "Upload your pitch deck for analysis")}
                </h3>
                <p className="text-sm leading-relaxed text-emerald-100/85">
                  {t(
                    "نستخرج حقول ملف شركتك من العرض التقديمي (PDF/PPTX) ويبقى كل حقل بانتظار تأكيدك، مع اقتباس الشريحة لكل قيمة — لا يدخل الملف شيء بلا تأكيد.",
                    "We extract your company profile fields from the deck (PDF/PPTX); every field awaits your confirmation with its slide quote — nothing enters your profile unconfirmed.",
                  )}
                </p>
              </div>
              <Button
                className="mt-auto h-11 w-fit bg-emerald-50 text-emerald-950 hover:bg-emerald-200"
                onClick={() => onNavigate("deck")}
              >
                {t("ارفع العرض التقديمي", "Upload pitch deck")}
              </Button>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          whileHover={{ y: -3 }}
          transition={{ type: "spring", stiffness: 320, damping: 26 }}
          className="h-full"
        >
          <Card className="h-full overflow-hidden border-amber-800/25 bg-gradient-to-br from-amber-50 via-orange-50 to-stone-100 text-foreground dark:from-amber-950/40 dark:via-orange-950/30 dark:to-stone-900/60">
            <CardContent className="flex h-full flex-col gap-4 p-6">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-600/15 text-amber-700 dark:text-amber-400"
                aria-hidden="true"
              >
                <Zap className="h-6 w-6" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-semibold leading-snug">
                  {t("فحص سريع بلا حساب", "Quick check — no account needed")}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t(
                    "زائر؟ أجب عن أسئلة قليلة عن شركتك واحصل فورًا على أحكام مبدئية على الفرص المنشورة، ثم سجّل لتحفظ النتائج.",
                    "A visitor? Answer a few questions about your company and get preliminary verdicts on published opportunities instantly — sign up later to keep them.",
                  )}
                </p>
              </div>
              <Button
                variant="outline"
                className="mt-auto h-11 w-fit border-amber-700/40 bg-transparent hover:bg-amber-600/10 hover:text-foreground"
                onClick={() => onNavigate("quickcheck")}
              >
                {t("ابدأ الفحص السريع", "Start the quick check")}
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </section>

      {/* ————— كيف يحكم مسار؟ ————— */}
      <section aria-labelledby="how-masar-judges">
        <Card>
          <CardHeader>
            <CardTitle id="how-masar-judges" className="text-xl">
              {t("كيف يحكم «مسار»؟", "How does Masar decide?")}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {t(
                "ثلاث خطوات واضحة — الأهلية تقرّرها القواعد وحدها، والأدلة مرافقة لكل حكم.",
                "Three clear steps — eligibility is decided by rules alone, and evidence accompanies every verdict.",
              )}
            </p>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {howSteps.map((step, i) => (
              <motion.div
                key={step.title}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08, duration: 0.35 }}
                className="flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/40 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-600/15 text-emerald-700 dark:text-emerald-400"
                    aria-hidden="true"
                  >
                    <step.icon className="h-5 w-5" />
                  </span>
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    {t("الخطوة", "Step")} {i + 1}
                  </span>
                </div>
                <h4 className="font-semibold leading-snug">{step.title}</h4>
                <p className="text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
              </motion.div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
