"use client";
/**
 * Masar — T18: المتتبع والإشعارات (TrackerView)
 * =============================================================================
 * شاشة واحدة بتبويبين:
 *  - «الطلبات»: GET /applications → بطاقات (الفرصة/الموعد مع «فائت»/حالة Select
 *    بتغيير فوري PATCH /applications/[id]/ملاحظات textarea بحفظ) — لا حذف؛
 *    حالة WITHDRAWN تكفي. EmptyState «تتبّع فرصك من صفحة المطابقات».
 *  - «الإشعارات»: GET /notifications → قائمة بأيقونة حسب eventType + payloadAr
 *    + زر انتقال للفرصة (onNavigate("opportunities", {id})) + غير المقروء بخلفية
 *    مميزة + «تعليم الكل مقروءًا» + PATCH فردي عند النقر.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { useI18n, formatDate, formatMoney } from "@/components/app/i18n";
import { EmptyState } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import {
  ArrowLeft,
  Bell,
  BellRing,
  CalendarClock,
  CheckCheck,
  Clock,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  Tag,
} from "lucide-react";
import type { ViewProps } from "@/components/app/types";
import { cn } from "@/lib/utils";

// ————— قواميس محلية —————

const APP_STATUS_OPTIONS: Array<{
  value: string;
  ar: string;
  en: string;
}> = [
  { value: "INTERESTED", ar: "مهتم", en: "Interested" },
  { value: "PREPARING", ar: "يجهّز الطلب", en: "Preparing" },
  { value: "SUBMITTED", ar: "مقدَّم", en: "Submitted" },
  { value: "REJECTED", ar: "مرفوض", en: "Rejected" },
  { value: "WITHDRAWN", ar: "مسحوب", en: "Withdrawn" },
];

const APP_STATUS_CLS: Record<string, string> = {
  INTERESTED:
    "border-teal-300 bg-teal-100 text-teal-800 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300",
  PREPARING:
    "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  SUBMITTED:
    "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  REJECTED:
    "border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300",
  WITHDRAWN: "border-border bg-muted text-muted-foreground",
};

const EVENT_TYPE_CONF: Record<
  string,
  { ar: string; en: string; icon: React.ReactNode; cls: string }
> = {
  SUBSTANTIVE_CHANGE: {
    ar: "تغيير جوهري",
    en: "Substantive change",
    icon: <RefreshCw className="size-4" aria-hidden />,
    cls: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  STATUS_CHANGE: {
    ar: "تغيير حالة",
    en: "Status change",
    icon: <Tag className="size-4" aria-hidden />,
    cls: "border-teal-300 bg-teal-100 text-teal-800 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300",
  },
  DEADLINE_SOON: {
    ar: "الموعد يقترب",
    en: "Deadline soon",
    icon: <CalendarClock className="size-4" aria-hidden />,
    cls: "border-orange-300 bg-orange-100 text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300",
  },
  NEW_OPPORTUNITY: {
    ar: "فرصة جديدة",
    en: "New opportunity",
    icon: <Sparkles className="size-4" aria-hidden />,
    cls: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
};

const SCROLL_CLS =
  "max-h-96 overflow-y-auto pe-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border";

// ————— أنواع (أشكال موثقة من T14) —————

interface ApplicationRow {
  id: string;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  opportunity: {
    id: string;
    title: string;
    orgName: string;
    type: string;
    fundingType: string | null;
    currency: string;
    amountMin: number | null;
    amountMax: number | null;
    status: string;
  } | null;
  deadline: string | null;
  deadlineIsPast: boolean;
}

interface NotificationRow {
  id: string;
  eventType: string;
  opportunity: { id: string; title: string } | null;
  payloadAr: string;
  payloadEn?: string;
  readAt: string | null;
  createdAt: string;
}

// ————— المكوّن —————

export default function TrackerView({ onNavigate }: ViewProps) {
  const { t, lang } = useI18n();

  // الطلبات
  const [apps, setApps] = useState<ApplicationRow[] | null>(null);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [busyAppId, setBusyAppId] = useState<string | null>(null);
  const [notesDrafts, setNotesDrafts] = useState<Record<string, string>>({});

  // الإشعارات
  const [notifs, setNotifs] = useState<NotificationRow[] | null>(null);
  const [notifsLoading, setNotifsLoading] = useState(true);
  const [notifsError, setNotifsError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const loadApps = useCallback(async () => {
    setAppsLoading(true);
    setAppsError(null);
    try {
      const data = await api.get<{ applications?: ApplicationRow[] }>(
        "/applications",
      );
      const rows = Array.isArray((data as Record<string, unknown>)?.applications)
        ? ((data as Record<string, unknown>).applications as ApplicationRow[])
        : Array.isArray(data)
          ? (data as ApplicationRow[])
          : [];
      setApps(rows);
      setNotesDrafts(
        Object.fromEntries(rows.map((r) => [r.id, r.notes ?? ""])),
      );
    } catch (e) {
      setAppsError(
        e instanceof Error
          ? e.message
          : t("تعذّر جلب الطلبات", "Failed to load applications"),
      );
      setApps([]);
    } finally {
      setAppsLoading(false);
    }
  }, [t]);

  const loadNotifs = useCallback(async () => {
    setNotifsLoading(true);
    setNotifsError(null);
    try {
      const data = await api.get<{ notifications?: NotificationRow[] }>(
        "/notifications",
      );
      const rows = Array.isArray(
        (data as Record<string, unknown>)?.notifications,
      )
        ? ((data as Record<string, unknown>).notifications as NotificationRow[])
        : Array.isArray(data)
          ? (data as NotificationRow[])
          : [];
      setNotifs(rows);
    } catch (e) {
      setNotifsError(
        e instanceof Error
          ? e.message
          : t("تعذّر جلب الإشعارات", "Failed to load notifications"),
      );
      setNotifs([]);
    } finally {
      setNotifsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadApps();
    void loadNotifs();
  }, [loadApps, loadNotifs]);

  // ————— تحديث حالة الطلب (فوري) —————
  const changeStatus = useCallback(
    async (id: string, status: string) => {
      const prev = apps;
      setBusyAppId(id);
      // تحديث متفائل ثم PATCH
      setApps((cur) =>
        (cur ?? []).map((a) => (a.id === id ? { ...a, status } : a)),
      );
      try {
        await api.patch<unknown>(`/applications/${id}`, { status });
        toast.success(
          t(
            `حُدّثت الحالة إلى «${APP_STATUS_OPTIONS.find((s) => s.value === status)?.ar ?? status}»`,
            `Status updated to "${status}"`,
          ),
        );
      } catch (e) {
        setApps(prev ?? null);
        toast.error(
          e instanceof Error && e.message
            ? e.message
            : t("تعذّر تحديث الحالة", "Could not update status"),
        );
      } finally {
        setBusyAppId(null);
      }
    },
    [apps, t],
  );

  // ————— حفظ ملاحظات الطلب —————
  const saveNotes = useCallback(
    async (id: string) => {
      const draft = notesDrafts[id] ?? "";
      setBusyAppId(id);
      try {
        await api.patch<unknown>(`/applications/${id}`, {
          notes: draft.trim() === "" ? null : draft,
        });
        setApps((cur) =>
          (cur ?? []).map((a) =>
            a.id === id ? { ...a, notes: draft.trim() === "" ? null : draft } : a,
          ),
        );
        toast.success(t("حُفظت الملاحظات", "Notes saved"));
      } catch (e) {
        toast.error(
          e instanceof Error && e.message
            ? e.message
            : t("تعذّر حفظ الملاحظات", "Could not save notes"),
        );
      } finally {
        setBusyAppId(null);
      }
    },
    [notesDrafts, t],
  );

  // ————— تعليم إشعار مقروءًا —————
  const markRead = useCallback(
    async (id: string) => {
      const target = (notifs ?? []).find((n) => n.id === id);
      if (!target || target.readAt) return;
      setNotifs((cur) =>
        (cur ?? []).map((n) =>
          n.id === id ? { ...n, readAt: new Date().toISOString() } : n,
        ),
      );
      try {
        await api.patch<unknown>(`/notifications/${id}`);
      } catch (e) {
        toast.error(
          e instanceof Error && e.message
            ? e.message
            : t("تعذّر تعليم الإشعار مقروءًا", "Could not mark as read"),
        );
      }
    },
    [notifs, t],
  );

  const markAllRead = useCallback(async () => {
    const unread = (notifs ?? []).filter((n) => !n.readAt);
    if (unread.length === 0) return;
    setMarkingAll(true);
    const now = new Date().toISOString();
    setNotifs((cur) => (cur ?? []).map((n) => ({ ...n, readAt: n.readAt ?? now })));
    const results = await Promise.allSettled(
      unread.map((n) => api.patch<unknown>(`/notifications/${n.id}`)),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      toast.error(
        t(
          `تعذّر تعليم ${failed} إشعارًا مقروءًا`,
          `Failed to mark ${failed} notification(s) as read`,
        ),
      );
    } else {
      toast.success(
        t(
          `عُلِّمت ${unread.length} إشعارًا مقروءًا`,
          `Marked ${unread.length} notification(s) as read`,
        ),
      );
    }
    setMarkingAll(false);
  }, [notifs, t]);

  const unreadCount = useMemo(
    () => (notifs ?? []).filter((n) => !n.readAt).length,
    [notifs],
  );

  // ————— عناصر —————

  const statusBadgeCls = (status: string) =>
    APP_STATUS_CLS[status] ?? "border-border bg-muted text-muted-foreground";

  const renderApplications = () => {
    if (appsLoading) {
      return (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      );
    }
    if (appsError) {
      return (
        <EmptyState
          iconAr="⚠️"
          title={t("تعذّر جلب الطلبات", "Failed to load applications")}
          hintAr={appsError}
          action={
            <Button variant="outline" onClick={() => void loadApps()} className="h-11">
              <RefreshCw className="size-4" aria-hidden />
              {t("إعادة المحاولة", "Retry")}
            </Button>
          }
        />
      );
    }
    if (!apps || apps.length === 0) {
      return (
        <EmptyState
          iconAr="📮"
          title={t("لا طلبات متتبَّعة بعد", "No tracked applications yet")}
          hintAr={t(
            "تتبّع فرصك من صفحة المطابقات — من زر «تتبّع هذه الفرصة» على الفرصة المناسبة.",
            "Track opportunities from the Matches page — via “Track this opportunity” on a fitting opportunity.",
          )}
          action={
            <Button onClick={() => onNavigate("matches")} className="h-11">
              <ArrowLeft className="size-4" aria-hidden />
              {t("الذهاب إلى المطابقات", "Go to matches")}
            </Button>
          }
        />
      );
    }
    return (
      <ul className={cn("space-y-3", SCROLL_CLS)}>
        {apps.map((a) => {
          const draft = notesDrafts[a.id] ?? "";
          const dirty = draft !== (a.notes ?? "");
          const statusOpt = APP_STATUS_OPTIONS.find((s) => s.value === a.status);
          return (
            <li key={a.id}>
              <Card className="p-4 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <h3 className="font-bold break-words">
                      {a.opportunity?.title ?? t("فرصة محذوفة", "Deleted opportunity")}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {a.opportunity?.orgName ?? "—"}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                      {a.deadline ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Clock className="size-3.5" aria-hidden />
                          {formatDate(a.deadline, lang)}
                          {a.deadlineIsPast ? (
                            <Badge
                              variant="outline"
                              className="border-rose-300 text-rose-700 dark:border-rose-700 dark:text-rose-300"
                            >
                              {t("فائت", "Past")}
                            </Badge>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {t("بلا موعد نهائي", "No deadline")}
                        </span>
                      )}
                      {a.opportunity &&
                      (a.opportunity.amountMin !== null ||
                        a.opportunity.amountMax !== null) ? (
                        <span className="text-muted-foreground" dir="ltr">
                          {a.opportunity.amountMin !== null
                            ? formatMoney(
                                a.opportunity.amountMin,
                                a.opportunity.currency,
                                lang,
                              )
                            : "—"}
                          {" – "}
                          {a.opportunity.amountMax !== null
                            ? formatMoney(
                                a.opportunity.amountMax,
                                a.opportunity.currency,
                                lang,
                              )
                            : "—"}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-col items-stretch gap-2">
                    <span
                      className={cn(
                        "inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
                        statusBadgeCls(a.status),
                      )}
                      aria-label={t("الحالة الحالية", "Current status")}
                    >
                      {t(statusOpt?.ar ?? a.status, statusOpt?.en ?? a.status)}
                    </span>
                    <Select
                      value={a.status}
                      onValueChange={(v) => void changeStatus(a.id, v)}
                      disabled={busyAppId === a.id}
                    >
                      <SelectTrigger
                        className="h-11 w-44"
                        aria-label={t("تغيير الحالة", "Change status")}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {APP_STATUS_OPTIONS.map((s) => (
                          <SelectItem key={s.value} value={s.value} className="h-11">
                            {t(s.ar, s.en)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  <Textarea
                    dir="rtl"
                    rows={2}
                    maxLength={2000}
                    value={draft}
                    placeholder={t(
                      "ملاحظاتك على هذه الفرصة (ما أرسلته، ما ينقصك...)",
                      "Your notes on this opportunity (what you submitted, what's missing...)",
                    )}
                    onChange={(e) =>
                      setNotesDrafts((prev) => ({
                        ...prev,
                        [a.id]: e.target.value,
                      }))
                    }
                    aria-label={t("ملاحظات الطلب", "Application notes")}
                    className="leading-6"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {t("آخر تحديث", "Last update")}:{" "}
                      {formatDate(a.updatedAt, lang)}
                    </span>
                    <Button
                      size="sm"
                      variant={dirty ? "default" : "ghost"}
                      disabled={!dirty || busyAppId === a.id}
                      onClick={() => void saveNotes(a.id)}
                      className="h-11"
                    >
                      {busyAppId === a.id ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <Save className="size-4" aria-hidden />
                      )}
                      {t("حفظ الملاحظات", "Save notes")}
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    );
  };

  const renderNotifications = () => {
    if (notifsLoading) {
      return (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      );
    }
    if (notifsError) {
      return (
        <EmptyState
          iconAr="⚠️"
          title={t("تعذّر جلب الإشعارات", "Failed to load notifications")}
          hintAr={notifsError}
          action={
            <Button variant="outline" onClick={() => void loadNotifs()} className="h-11">
              <RefreshCw className="size-4" aria-hidden />
              {t("إعادة المحاولة", "Retry")}
            </Button>
          }
        />
      );
    }
    if (!notifs || notifs.length === 0) {
      return (
        <EmptyState
          iconAr="🔔"
          title={t("لا إشعارات", "No notifications")}
          hintAr={t(
            "ستظهر هنا تحديثات الفرص المهمة لك (تغيير جوهري، موعد يقترب، تغيير حالة).",
            "Important updates for your tracked opportunities (substantive changes, deadlines, status changes) will appear here.",
          )}
        />
      );
    }
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {t(
              `${unreadCount} غير مقروء من ${notifs.length}`,
              `${unreadCount} unread of ${notifs.length}`,
            )}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void markAllRead()}
            disabled={markingAll || unreadCount === 0}
            className="h-11"
          >
            {markingAll ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <CheckCheck className="size-4" aria-hidden />
            )}
            {t("تعليم الكل مقروءًا", "Mark all as read")}
          </Button>
        </div>
        <ul className={cn("space-y-2", SCROLL_CLS)}>
          {notifs.map((n) => {
            const conf = EVENT_TYPE_CONF[n.eventType] ?? {
              ar: n.eventType,
              en: n.eventType,
              icon: <Bell className="size-4" aria-hidden />,
              cls: "border-border bg-muted text-muted-foreground",
            };
            const unread = !n.readAt;
            return (
              <li key={n.id}>
                <div
                  role={unread ? "button" : undefined}
                  tabIndex={unread ? 0 : undefined}
                  onClick={() => unread && void markRead(n.id)}
                  onKeyDown={(e) => {
                    if (unread && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      void markRead(n.id);
                    }
                  }}
                  className={cn(
                    "rounded-xl border p-4 transition-colors",
                    unread
                      ? "cursor-pointer border-amber-300 bg-amber-50/70 hover:bg-amber-100/70 dark:border-amber-700 dark:bg-amber-950/40 dark:hover:bg-amber-900/40"
                      : "border-border bg-card",
                  )}
                  aria-label={
                    unread ? t("تعليم مقروءًا", "Mark as read") : undefined
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className={cn(
                          "mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full border",
                          conf.cls,
                        )}
                        aria-hidden
                      >
                        {conf.icon}
                      </span>
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-xs font-medium",
                              conf.cls,
                            )}
                          >
                            {t(conf.ar, conf.en)}
                          </span>
                          {unread ? (
                            <span
                              className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400"
                            >
                              <BellRing className="size-3.5" aria-hidden />
                              {t("جديد", "New")}
                            </span>
                          ) : null}
                          <time className="text-xs text-muted-foreground">
                            {formatDate(n.createdAt, lang)}
                          </time>
                        </div>
                        <p className="text-sm leading-6 text-foreground">
                          {lang === "ar" ? n.payloadAr : n.payloadEn ?? "An update was made. Review the related opportunity for the latest details."}
                        </p>
                        {n.opportunity ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-11"
                            onClick={(e) => {
                              e.stopPropagation();
                              onNavigate("opportunities", {
                                id: n.opportunity?.id,
                              });
                            }}
                          >
                            <ArrowLeft className="size-4" aria-hidden />
                            {n.opportunity.title}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Toaster richColors closeButton position="top-center" dir={lang === "ar" ? "rtl" : "ltr"} />
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">
          {t("المتتبع والإشعارات", "Tracker & notifications")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "تابع طلبات فرصك وحالاتها وملاحظاتك، وابقَ على اطلاع بتحديثات الفرص المهمة — دون تكرار.",
            "Track your applications, statuses, and notes, and stay updated on important opportunity changes — without duplicates.",
          )}
        </p>
      </header>

      <Tabs defaultValue="applications" dir={lang === "ar" ? "rtl" : "ltr"}>
        <TabsList className="h-auto w-full flex-wrap gap-1 p-1">
          <TabsTrigger value="applications" className="h-11 flex-1 min-w-32">
            {t("الطلبات", "Applications")}
          </TabsTrigger>
          <TabsTrigger value="notifications" className="h-11 flex-1 min-w-32">
            {t("الإشعارات", "Notifications")}
            {unreadCount > 0 ? (
              <Badge
                variant="secondary"
                className="ms-1 tabular-nums"
                aria-label={t("غير المقروءة", "Unread")}
              >
                {unreadCount}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="applications" className="mt-4">
          {renderApplications()}
        </TabsContent>
        <TabsContent value="notifications" className="mt-4">
          {renderNotifications()}
        </TabsContent>
      </Tabs>
    </div>
  );
}
