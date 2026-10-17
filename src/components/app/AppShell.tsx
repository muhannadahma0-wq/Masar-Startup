"use client";
/**
 * Masar — AppShell (T15)
 * ---------------------------------------------------------------------------
 * الهيكل العام: رأس ثابت sticky (شعار + تنقل ديسكتوب/موبايل + لغة/ثيم/حساب)
 * + main بعرض أقصى مع انتقال AnimatePresence خفيف (fade 150ms)
 * + تذييل ثابت أسفل الشاشة (mt-auto — الجذر flex column).
 *
 * ملاحظة تكامل مهمة (للمنسّق T20): AppShell يركّب داخليًّا `I18nProvider`
 * و`ThemeProvider` من next-themes (attribute="class") — لا حاجة لتركيبهما في
 * page.tsx. ولو رُكّب مزوّد خارجي فالتداخل آمن: المزوّد الداخلي هو السائد
 * لكل ما داخل القشرة (بما فيه شاشات T16–T18 الممرّرة عبر children).
 *
 * إن كان user=null: التنقل يعرض (الرئيسية، الفحص السريع) فقط + زر «تسجيل
 * الدخول» (يحدّث الصفحة — page.tsx يعيد جلب الجلسة ويعرض AuthForms).
 */

import * as React from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  Building2,
  ChevronDown,
  ClipboardList,
  FileText,
  Gauge,
  Home,
  Landmark,
  Languages,
  Loader2,
  LogIn,
  LogOut,
  MapPinned,
  Menu,
  Moon,
  MoreHorizontal,
  Presentation,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Target,
  Zap,
} from "lucide-react";

import { api } from "@/lib/api-client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { I18nProvider, useI18n } from "./i18n";
import { VIEW_LABELS, type SessionUserSummary, type ViewKey } from "./types";

export interface AppShellProps {
  user: SessionUserSummary | null;
  activeView: ViewKey;
  onNavigate: (v: ViewKey) => void;
  children: React.ReactNode;
}

type IconType = React.ComponentType<{ className?: string }>;

const VIEW_ICONS: Record<ViewKey, IconType> = {
  home: Home,
  opportunities: Landmark,
  matches: Target,
  profile: Building2,
  deck: Presentation,
  tracker: ClipboardList,
  documents: FileText,
  notifications: Bell,
  whatif: SlidersHorizontal,
  quickcheck: Zap,
  readiness: Gauge,
  admin: ShieldCheck,
};

/** التبويبات الرئيسية في الشريط العلوي (الديسكتوب) — البقية ضمن «المزيد». */
const PRIMARY_AUTHED: ViewKey[] = [
  "home",
  "opportunities",
  "matches",
  "deck",
  "tracker",
];
const SECONDARY_AUTHED: ViewKey[] = [
  "profile",
  "readiness",
  "whatif",
  "documents",
  "notifications",
  "quickcheck",
];
/** زائر بلا جلسة: تنقل مختصر فقط. */
const GUEST_NAV: ViewKey[] = ["home", "quickcheck"];

function viewLabel(view: ViewKey, t: (ar: string, en: string) => string): string {
  return t(VIEW_LABELS[view].ar, VIEW_LABELS[view].en);
}

/* ————————————————— التبويب (ديسكتوب) ————————————————— */

function NavButton({
  view,
  active,
  onNavigate,
  className,
}: {
  view: ViewKey;
  active: boolean;
  onNavigate: (v: ViewKey) => void;
  className?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const label = viewLabel(view, t);
  const Icon = VIEW_ICONS[view];
  return (
    <button
      type="button"
      onClick={() => onNavigate(view)}
      aria-current={active ? "page" : undefined}
      title={label}
      className={cn(
        "inline-flex h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active
          ? "bg-primary text-primary-foreground shadow-xs"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        className,
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {label}
    </button>
  );
}

/* ————————————————— عنصر قائمة التنقل (موبايل Sheet) ————————————————— */

function SheetNavItem({
  view,
  active,
  onNavigate,
  onSelect,
}: {
  view: ViewKey;
  active: boolean;
  onNavigate: (v: ViewKey) => void;
  onSelect: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const label = viewLabel(view, t);
  const Icon = VIEW_ICONS[view];
  return (
    <li>
      <button
        type="button"
        onClick={() => {
          onNavigate(view);
          onSelect();
        }}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-11 w-full items-center gap-3 rounded-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
          active
            ? "bg-primary text-primary-foreground shadow-xs"
            : "text-foreground hover:bg-accent hover:text-accent-foreground",
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {label}
      </button>
    </li>
  );
}

/* ————————————————— جسم الهيكل (داخل المزوّدين) ————————————————— */

function ShellBody({
  user,
  activeView,
  onNavigate,
  children,
}: AppShellProps): React.JSX.Element {
  const { t, lang, setLang, dir } = useI18n();
  const { setTheme, resolvedTheme } = useTheme();
  const [navOpen, setNavOpen] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);

  const primaryNav: ViewKey[] = user ? PRIMARY_AUTHED : GUEST_NAV;
  const secondaryNav: ViewKey[] = user ? SECONDARY_AUTHED : [];
  const showAdmin = user?.role === "REVIEWER" || user?.role === "ADMIN";
  const moreActive = user !== null && !primaryNav.includes(activeView);

  const displayName = (user?.name?.trim() || user?.email || "؟").trim();
  const initial = displayName.charAt(0).toUpperCase();

  function handleLang(): void {
    setLang(lang === "ar" ? "en" : "ar");
  }

  function handleTheme(): void {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }

  async function handleLogout(): Promise<void> {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await api.post("/auth/logout");
    } catch {
      // الجلسة تُدار من الخادم — التحديث يعرض شاشة الدخول على أي حال
    } finally {
      window.location.reload();
    }
  }

  /** زائر بلا جلسة: تحديث الصفحة يعيده إلى شاشة الدخول (يقررها page.tsx). */
  function handleLogin(): void {
    window.location.reload();
  }

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#masar-main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        {t("تخطَّ إلى المحتوى", "Skip to content")}
      </a>

      {/* ————— الرأس الثابت ————— */}
      <header className="sticky top-0 z-40 border-b bg-background/95 shadow-xs backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-4 md:px-8">
          {/* قائمة الموبايل */}
          <div className="md:hidden">
            <Sheet open={navOpen} onOpenChange={setNavOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  aria-label={t("فتح قائمة التنقل", "Open navigation menu")}
                >
                  <Menu className="size-5" aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side={dir === "rtl" ? "right" : "left"}
                className="w-72 gap-0 p-0"
              >
                <SheetHeader className="border-b p-4">
                  <SheetTitle asChild>
                    <span className="flex items-center gap-2">
                      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                        <MapPinned className="size-4" aria-hidden="true" />
                      </span>
                      <span className="text-lg font-bold">
                        مسار{" "}
                        <span className="text-xs font-medium tracking-widest text-muted-foreground">
                          MASAR
                        </span>
                      </span>
                    </span>
                  </SheetTitle>
                  <SheetDescription className="sr-only">
                    {t("قائمة التنقل الكاملة", "Full navigation menu")}
                  </SheetDescription>
                </SheetHeader>

                <nav
                  aria-label={t("التنقل", "Navigation")}
                  className="max-h-[calc(100dvh-12rem)] flex-1 overflow-y-auto p-3"
                >
                  <ul className="flex flex-col gap-1">
                    {primaryNav.map((v) => (
                      <SheetNavItem
                        key={v}
                        view={v}
                        active={activeView === v}
                        onNavigate={onNavigate}
                        onSelect={() => setNavOpen(false)}
                      />
                    ))}
                  </ul>
                  {secondaryNav.length > 0 ? (
                    <>
                      <Separator className="my-3" />
                      <ul className="flex flex-col gap-1">
                        {secondaryNav.map((v) => (
                          <SheetNavItem
                            key={v}
                            view={v}
                            active={activeView === v}
                            onNavigate={onNavigate}
                            onSelect={() => setNavOpen(false)}
                          />
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {showAdmin ? (
                    <>
                      <Separator className="my-3" />
                      <ul className="flex flex-col gap-1">
                        <SheetNavItem
                          view="admin"
                          active={activeView === "admin"}
                          onNavigate={onNavigate}
                          onSelect={() => setNavOpen(false)}
                        />
                      </ul>
                    </>
                  ) : null}
                </nav>

                {!user ? (
                  <div className="mt-auto border-t p-4">
                    <Button className="w-full gap-2" onClick={handleLogin}>
                      <LogIn className="size-4" aria-hidden="true" />
                      {t("تسجيل الدخول", "Sign in")}
                    </Button>
                  </div>
                ) : null}
              </SheetContent>
            </Sheet>
          </div>

          {/* الشعار */}
          <button
            type="button"
            onClick={() => onNavigate("home")}
            aria-label={t("مسار — الانتقال إلى الرئيسية", "Masar — go to home")}
            className="flex shrink-0 items-center gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
              <MapPinned className="size-5" aria-hidden="true" />
            </span>
            <span className="flex flex-col items-start leading-none">
              <span className="text-lg font-bold">مسار</span>
              <span className="text-[10px] font-medium tracking-[0.2em] text-muted-foreground">
                MASAR
              </span>
            </span>
          </button>

          {/* التنقل — ديسكتوب */}
          <nav
            aria-label={t("التنقل الرئيسي", "Primary navigation")}
            className="ms-4 hidden items-center gap-1 md:flex"
          >
            {primaryNav.map((v) => (
              <NavButton
                key={v}
                view={v}
                active={activeView === v}
                onNavigate={onNavigate}
              />
            ))}

            {user && (secondaryNav.length > 0 || showAdmin) ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className={cn(
                      "h-11 gap-1.5 px-3 text-sm font-medium",
                      moreActive
                        ? "bg-primary text-primary-foreground shadow-xs hover:bg-primary hover:text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <MoreHorizontal className="size-4" aria-hidden="true" />
                    <span>{t("المزيد", "More")}</span>
                    <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-44">
                  {secondaryNav.map((v) => {
                    const Icon = VIEW_ICONS[v];
                    return (
                      <DropdownMenuItem
                        key={v}
                        onClick={() => onNavigate(v)}
                        className={cn(
                          "h-10 gap-2",
                          activeView === v && "bg-accent font-semibold text-accent-foreground",
                        )}
                      >
                        <Icon className="size-4" aria-hidden="true" />
                        {viewLabel(v, t)}
                      </DropdownMenuItem>
                    );
                  })}
                  {showAdmin ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => onNavigate("admin")}
                        className={cn(
                          "h-10 gap-2",
                          activeView === "admin" && "bg-accent font-semibold text-accent-foreground",
                        )}
                      >
                        <ShieldCheck className="size-4" aria-hidden="true" />
                        {viewLabel("admin", t)}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </nav>

          {/* أزرار الرأس: لغة، ثيم، حساب */}
          <div className="ms-auto flex items-center gap-1">
            <Button
              variant="ghost"
              className="h-11 gap-1.5 px-2"
              onClick={handleLang}
              aria-label={t("التبديل إلى الإنجليزية", "Switch to Arabic")}
              title={t("التبديل إلى الإنجليزية", "Switch to Arabic")}
            >
              <Languages className="size-5" aria-hidden="true" />
              <span className="hidden text-xs font-semibold sm:inline">
                {lang === "ar" ? "EN" : "ع"}
              </span>
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              onClick={handleTheme}
              aria-label={t("تبديل الوضع الفاتح/الداكن", "Toggle light/dark mode")}
              title={t("تبديل الوضع الفاتح/الداكن", "Toggle light/dark mode")}
            >
              <Sun className="size-5 dark:hidden" aria-hidden="true" />
              <Moon className="hidden size-5 dark:block" aria-hidden="true" />
            </Button>

            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("قائمة الحساب", "Account menu")}
                    className="inline-flex h-11 items-center gap-2 rounded-full border bg-card px-1.5 py-1.5 pe-3 ps-1.5 outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <Avatar className="size-8">
                      <AvatarFallback className="bg-primary text-sm font-semibold text-primary-foreground">
                        {initial}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden max-w-28 truncate text-sm font-medium lg:inline">
                      {user.name ?? user.email}
                    </span>
                    <ChevronDown
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="flex flex-col gap-0.5">
                    <span className="truncate font-semibold">
                      {user.name ?? t("بدون اسم", "Unnamed")}
                    </span>
                    <span
                      dir="ltr"
                      className="truncate text-xs font-normal text-muted-foreground"
                    >
                      {user.email}
                    </span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => void handleLogout()}
                    disabled={loggingOut}
                    className="h-11"
                  >
                    {loggingOut ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <LogOut aria-hidden="true" />
                    )}
                    {loggingOut
                      ? t("جارٍ تسجيل الخروج…", "Signing out…")
                      : t("تسجيل الخروج", "Sign out")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button className="h-11 gap-2" onClick={handleLogin}>
                <LogIn className="size-4" aria-hidden="true" />
                {t("تسجيل الدخول", "Sign in")}
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* ————— المحتوى ————— */}
      <main id="masar-main" className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeView}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* ————— التذييل الثابت أسفل الشاشة ————— */}
      <footer className="mt-auto border-t bg-card/40">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between md:px-8">
          <p className="leading-relaxed">
            {t(
              "مسار © 2026 — لا يضمن تمويلًا ولا يتنبأ به؛ كل حكم يستند إلى أدلة",
              "Masar © 2026 — no funding is guaranteed or predicted; every judgment is evidence-based",
            )}
          </p>
          <nav
            aria-label={t("روابط سفلية", "Footer links")}
            className="flex shrink-0 items-center gap-1"
          >
            <button
              type="button"
              onClick={() => onNavigate("opportunities")}
              className="inline-flex h-11 items-center rounded-md px-2 font-medium transition-colors hover:text-foreground hover:underline underline-offset-4"
            >
              {t("الفرص", "Opportunities")}
            </button>
            <button
              type="button"
              onClick={() => onNavigate("quickcheck")}
              className="inline-flex h-11 items-center rounded-md px-2 font-medium transition-colors hover:text-foreground hover:underline underline-offset-4"
            >
              {t("الفحص السريع", "Quick Check")}
            </button>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/* ————————————————— التصدير: القشرة مع المزوّدين ————————————————— */

export function AppShell({
  user,
  activeView,
  onNavigate,
  children,
}: AppShellProps): React.JSX.Element {
  return (
    <I18nProvider>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem={false}
        disableTransitionOnChange
      >
        <ShellBody
          user={user}
          activeView={activeView}
          onNavigate={onNavigate}
        >
          {children}
        </ShellBody>
      </ThemeProvider>
    </I18nProvider>
  );
}
