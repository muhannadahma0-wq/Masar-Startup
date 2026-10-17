"use client";
/**
 * مسار | Masar — الصفحة الوحيدة المرئية: هيكل التطبيق وتبديل الشاشات
 * المنسّق (T20): يربط كل شاشات الوحدات في AppShell مع بوابة المصادقة.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { useI18n } from "@/components/app/i18n";
import { AuthForms } from "@/components/app/AuthForms";
import { EmptyState } from "@/components/app/badges";
import type { SessionUserSummary, ViewKey } from "@/components/app/types";
import { api } from "@/lib/api-client";

import HomeView from "@/components/views/HomeView";
import OpportunitiesView from "@/components/views/OpportunitiesView";
import MatchesView from "@/components/views/MatchesView";
import ProfileView from "@/components/views/ProfileView";
import DeckView from "@/components/views/DeckView";
import TrackerView from "@/components/views/TrackerView";
import DocumentsView from "@/components/views/DocumentsView";
import ReadinessView from "@/components/views/ReadinessView";
import WhatIfView from "@/components/views/WhatIfView";
import QuickCheckView from "@/components/views/QuickCheckView";
import AdminView from "@/components/views/AdminView";
import { MapPinned, Compass, ShieldCheck, FileSearch } from "lucide-react";

/** شاشات عامة بلا حساب */
const PUBLIC_VIEWS: ViewKey[] = ["quickcheck"];
/** شاشات المتابعة (الإشعارات ضمن المتتبع) */
const AUTHED_VIEWS: ViewKey[] = [
  "home", "opportunities", "matches", "profile", "deck",
  "tracker", "documents", "whatif", "readiness", "admin",
];

function readViewFromUrl(): ViewKey {
  if (typeof window === "undefined") return "home";
  const v = new URLSearchParams(window.location.search).get("view");
  if (v && AUTHED_VIEWS.includes(v as ViewKey) || v && PUBLIC_VIEWS.includes(v as ViewKey)) {
    return v as ViewKey;
  }
  return "home";
}

export default function MasarApp() {
  const [user, setUser] = useState<SessionUserSummary | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [view, setView] = useState<ViewKey>("home");
  const [params, setParams] = useState<Record<string, unknown> | undefined>(undefined);

  // جلب الجلسة
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<{ user: SessionUserSummary }>("/auth/me");
        if (!cancelled) setUser(data.user);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // مزامنة العرض مع رابط الصفحة الوحيد (?view=)
  useEffect(() => {
    setView(readViewFromUrl());
  }, []);

  const onNavigate = useCallback((v: ViewKey, p?: Record<string, unknown>) => {
    setView(v);
    setParams(p);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("view", v);
      window.history.replaceState({}, "", url.toString());
    } catch { /* تجاهل */ }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const data = await api.get<{ user: SessionUserSummary }>("/auth/me");
      setUser(data.user);
    } catch {
      setUser(null);
    }
  }, []);

  const renderView = useMemo(() => {
    if (!user) return null;
    switch (view) {
      case "home": return <HomeView onNavigate={onNavigate} params={params} />;
      case "opportunities": return <OpportunitiesView onNavigate={onNavigate} params={params} />;
      case "matches": return <MatchesView onNavigate={onNavigate} params={params} />;
      case "profile": return <ProfileView onNavigate={onNavigate} params={params} />;
      case "deck": return <DeckView onNavigate={onNavigate} params={params} />;
      case "tracker": return <TrackerView onNavigate={onNavigate} params={params} />;
      case "documents": return <DocumentsView onNavigate={onNavigate} params={params} />;
      case "whatif": return <WhatIfView onNavigate={onNavigate} params={params} />;
      case "readiness": return <ReadinessView onNavigate={onNavigate} params={params} />;
      case "admin": return <AdminView onNavigate={onNavigate} params={params} />;
      default: return null;
    }
  }, [user, view, params, onNavigate]);

  const isPublic = PUBLIC_VIEWS.includes(view);
  const needsAuth = !isPublic;
  const openAuth = params?.openAuth === true;

  return (
    <AppShell user={user} activeView={view} onNavigate={onNavigate}>
      {!authChecked ? (
        <LoadingStatus />
      ) : !user && needsAuth ? (
        <div className="py-8 md:py-12">
          {view === "home" && !openAuth ? (
            <LandingHero onNavigate={onNavigate} />
          ) : (
            <AuthForms onAuthed={refreshUser} />
          )}
        </div>
      ) : !user && isPublic ? (
        <QuickCheckView onNavigate={onNavigate} params={params} />
      ) : view === "quickcheck" ? (
        <QuickCheckView onNavigate={onNavigate} params={params} />
      ) : view === "admin" && user && !["REVIEWER", "ADMIN"].includes(user.role) ? (
        <div className="py-12"><AdminDenied /></div>
      ) : (
        renderView
      )}
    </AppShell>
  );
}

/** صفحة هبوط للزائر قبل الدخول */
function LoadingStatus() {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center min-h-[60vh]" aria-busy="true">
      <div className="animate-pulse flex flex-col items-center gap-3 text-muted-foreground">
        <MapPinned className="h-10 w-10" aria-hidden="true" />
        <span>{t("جارٍ تحميل مسار...", "Loading Masar...")}</span>
      </div>
    </div>
  );
}

function AdminDenied() {
  const { t } = useI18n();
  return <EmptyState iconAr="!" title={t("لوحة المراجعة للمسؤولين فقط", "The review dashboard is for reviewers and admins only")} hintAr={t("حسابك بأدوار المؤسس — يمكنك تصفح الفرص والمطابقات وعرضك التقديمي.", "Your account has the founder role. You can browse opportunities, matches, and your pitch deck.")} />;
}

function LandingHero({ onNavigate }: { onNavigate: (v: ViewKey, p?: Record<string, unknown>) => void }) {
  const [showAuth, setShowAuth] = useState(false);
  const { t } = useI18n();
  return (
    <div className="py-10 md:py-16">
      <div className="max-w-3xl mx-auto text-center space-y-6">
        <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary px-4 py-1.5 text-sm font-medium">
          <MapPinned className="h-4 w-4" aria-hidden="true" />
          {t("مسار | Masar — فرص تمويل موثّقة وأهلية مفسّرة", "Masar — verified funding opportunities and explainable eligibility")}
        </div>
        <h1 className="text-3xl md:text-5xl font-bold leading-tight">
          {t("اعرف الفرص التي", "Find the opportunities")} <span className="text-primary">{t("يحق لك", "you can")}</span> {t("التقديم إليها فعلًا، ولماذا", "actually apply to — and why")}
        </h1>
        <p className="text-muted-foreground text-base md:text-lg leading-relaxed max-w-2xl mx-auto">
          {t("محرك أهلية حتمي يشرح حكمه بالأدلة حتى نص الجهة الرسمي، وتحليل لعرضك التقديمي لا يدخل ملفك إلا ما تؤكده أنت، ومتتبع طلبات بإشعارات بلا تكرار. لا نتنبأ بالتمويل ولا نضمنه — نشرح الأهلية فقط.", "A deterministic eligibility engine explains each result using official-source evidence. Pitch analysis remains a draft until you confirm it, while an application tracker keeps notifications organized. We do not predict or guarantee funding; we explain eligibility.")}
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={() => setShowAuth(true)}
            className="h-11 px-6 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
          >
            {t("ابدأ الآن — أنشئ حسابك", "Get started — create an account")}
          </button>
          <button
            onClick={() => onNavigate("quickcheck")}
            className="h-11 px-6 rounded-md border border-border font-medium hover:bg-muted transition-colors"
          >
            {t("فحص سريع بلا حساب", "Quick check without an account")}
          </button>
        </div>
        {showAuth && (
          <div className="max-w-md mx-auto pt-4">
            <AuthForms onAuthed={async () => { window.location.href = "/"; }} />
          </div>
        )}
        <div className="grid sm:grid-cols-3 gap-4 pt-10 text-start">
          {[
            { icon: <Compass className="h-6 w-6 text-primary" />, title: t("حكم ثلاثي بالأدلة", "Three-state decisions with evidence"), desc: t("مؤهل أو غير مؤهل أو غير محسوم — مع اقتباس الجهة ورابط المصدر وتاريخ التحقق لكل شرط.", "Eligible, not eligible, or uncertain — with source excerpts, official links, and verification dates for each criterion.") },
            { icon: <ShieldCheck className="h-6 w-6 text-primary" />, title: t("null بدل التخمين", "Unknown instead of guessing"), desc: t("كل قيمة مستخرجة من عرضك لها صفحة واقتباس يتحقق منهما حارس الاقتباس، وإلا حُذفت.", "Each extracted value needs a slide and quote that pass the citation guard; otherwise it is rejected.") },
            { icon: <FileSearch className="h-6 w-6 text-primary" />, title: t("ملفك تحت سيطرتك", "You control your profile"), desc: t("لا يدخل ملف شركتك شيء إلا بعد تأكيدك، والأصل في تصحيح الشرائح محفوظ دائمًا.", "Nothing enters your startup profile until you confirm it, and the original pitch is always preserved.") },
          ].map((c) => (
            <div key={c.title} className="rounded-lg border border-border bg-card p-4 space-y-2">
              {c.icon}
              <h3 className="font-semibold">{c.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{c.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
