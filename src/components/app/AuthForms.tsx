"use client";
/**
 * Masar — AuthForms (T15)
 * ---------------------------------------------------------------------------
 * بطاقة مزدوجة (Tabs): تسجيل دخول / إنشاء حساب. الاستدعاء عبر عميل
 * @/lib/api-client (fetch نسبي + credentials same-origin) — الجلسة كوكي
 * httpOnly فلا يُخزَّن أي شيء في العميل. أخطاء الخادم (error.message عربي)
 * تُعرض في Alert واضح، مع حالة تحميل وتحقق عميل بسيط:
 * بريد صالح + كلمة مرور ≥8 (التسجيل) + اسم ≥2 حرفين.
 *
 * مكوّن ثنائي اللغة يستخدم مزوّد اللغة المشترك في AppShell — التسجيل العام
 * ينشئ حساب FOUNDER حصرًا
 * (سياسة الخادم T9).
 */

import * as React from "react";
import {
  Languages,
  Loader2,
  LogIn,
  MapPinned,
  TriangleAlert,
  UserPlus,
} from "lucide-react";

import { api } from "@/lib/api-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useI18n } from "./i18n";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AuthMode = "login" | "register";

export function AuthForms({
  onAuthed,
}: {
  onAuthed: () => void;
}): React.JSX.Element {
  // AppShell owns the single language provider; nesting another provider here
  // used to reset English users to Arabic on the authentication screen.
  return <AuthFormsInner onAuthed={onAuthed} />;
}

function AuthFormsInner({
  onAuthed,
}: {
  onAuthed: () => void;
}): React.JSX.Element {
  const { t, lang, setLang } = useI18n();
  const [mode, setMode] = React.useState<AuthMode>("login");
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  function switchMode(next: string): void {
    setMode(next === "register" ? "register" : "login");
    setError(null);
  }

  /** تحقق عميل بسيط — رسائل عربية/إنجليزية موجزة. */
  function validate(): string | null {
    if (!EMAIL_RE.test(email.trim())) {
      return t("أدخل بريدًا إلكترونيًّا صالحًا", "Enter a valid email address");
    }
    if (!password) {
      return t("أدخل كلمة المرور", "Enter your password");
    }
    if (mode === "register") {
      if (name.trim().length < 2) {
        return t("الاسم حرفان على الأقل", "Name must be at least 2 characters");
      }
      if (password.length < 8) {
        return t(
          "كلمة المرور 8 أحرف على الأقل",
          "Password must be at least 8 characters",
        );
      }
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (loading) return;
    const clientError = validate();
    if (clientError) {
      setError(clientError);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") {
        await api.post("/auth/login", { email: email.trim(), password });
      } else {
        await api.post("/auth/register", {
          email: email.trim(),
          password,
          name: name.trim(),
        });
      }
      onAuthed(); // الجلسة الآن في كوكي httpOnly
    } catch (err) {
      // error.message من الخادم عربي (مغلف {ok:false,error:{code,message}})
      setError(
        err instanceof Error
          ? err.message
          : t("حدث خطأ غير متوقع — أعد المحاولة", "Unexpected error — try again"),
      );
    } finally {
      setLoading(false);
    }
  }

  const submitLabel =
    mode === "login"
      ? loading
        ? t("جارٍ تسجيل الدخول…", "Signing in…")
        : t("تسجيل الدخول", "Sign in")
      : loading
        ? t("جارٍ إنشاء الحساب…", "Creating account…")
        : t("إنشاء الحساب", "Create account");

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card className="shadow-lg">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
                <MapPinned className="size-5" aria-hidden="true" />
              </span>
              <div className="flex flex-col leading-none">
                <CardTitle className="text-xl font-bold">مسار</CardTitle>
                <span className="mt-0.5 text-[10px] font-medium tracking-[0.2em] text-muted-foreground">
                  MASAR
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="ms-auto size-11"
                onClick={() => setLang(lang === "ar" ? "en" : "ar")}
                aria-label={t(
                  "التبديل إلى الإنجليزية",
                  "Switch to Arabic",
                )}
                title={t("التبديل إلى الإنجليزية", "Switch to Arabic")}
              >
                <Languages className="size-5" aria-hidden="true" />
              </Button>
            </div>
            <CardDescription className="pt-2 leading-relaxed">
              {t(
                "اعرف فرص التمويل التي تستوفي شروطها فعلًا — محرك أهلية بأدلة موثّقة وشرح واضح لكل حكم.",
                "Discover the funding opportunities you actually qualify for — a deterministic eligibility engine with documented evidence.",
              )}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <Tabs value={mode} onValueChange={switchMode}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login" className="h-9">
                  {t("تسجيل الدخول", "Sign in")}
                </TabsTrigger>
                <TabsTrigger value="register" className="h-9">
                  {t("إنشاء حساب", "Register")}
                </TabsTrigger>
              </TabsList>

              <form onSubmit={(e) => void handleSubmit(e)} noValidate>
                <TabsContent value="login" className="mt-4 flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="login-email">
                      {t("البريد الإلكتروني", "Email")}
                    </Label>
                    <Input
                      id="login-email"
                      type="email"
                      dir="ltr"
                      autoComplete="email"
                      inputMode="email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={loading}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="login-password">
                      {t("كلمة المرور", "Password")}
                    </Label>
                    <Input
                      id="login-password"
                      type="password"
                      dir="ltr"
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loading}
                      required
                    />
                  </div>
                </TabsContent>

                <TabsContent
                  value="register"
                  className="mt-4 flex flex-col gap-4"
                >
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="register-name">
                      {t("الاسم", "Name")}
                    </Label>
                    <Input
                      id="register-name"
                      type="text"
                      autoComplete="name"
                      placeholder={t("اسمك الكامل", "Your full name")}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={loading}
                      maxLength={80}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="register-email">
                      {t("البريد الإلكتروني", "Email")}
                    </Label>
                    <Input
                      id="register-email"
                      type="email"
                      dir="ltr"
                      autoComplete="email"
                      inputMode="email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={loading}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="register-password">
                      {t("كلمة المرور", "Password")}
                    </Label>
                    <Input
                      id="register-password"
                      type="password"
                      dir="ltr"
                      autoComplete="new-password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loading}
                      minLength={8}
                      maxLength={128}
                      required
                      aria-describedby="password-hint"
                    />
                    <p id="password-hint" className="text-xs text-muted-foreground">
                      {t(
                        "8 أحرف على الأقل — لا نطلب رموزًا خاصة.",
                        "At least 8 characters — no special characters required.",
                      )}
                    </p>
                  </div>
                </TabsContent>

                {error ? (
                  <Alert variant="destructive" className="mt-2">
                    <TriangleAlert aria-hidden="true" />
                    <AlertTitle>
                      {t("تعذّر إتمام العملية", "Action failed")}
                    </AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                <Button
                  type="submit"
                  className="mt-4 h-11 w-full gap-2 text-sm"
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : mode === "login" ? (
                    <LogIn className="size-4" aria-hidden="true" />
                  ) : (
                    <UserPlus className="size-4" aria-hidden="true" />
                  )}
                  {submitLabel}
                </Button>
              </form>
            </Tabs>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
          {t(
            "الجلسة محفوظة في كوكي آمن HttpOnly — لا نخزّن كلمة المرور ولا أي رمز في المتصفح.",
            "Your session lives in a secure HttpOnly cookie — no password or token is ever stored in the browser.",
          )}
        </p>
      </div>
    </div>
  );
}
