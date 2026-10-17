/**
 * Masar — أنواع مشتركة لواجهة الاستخدام (عقد §15)
 */
export type ViewKey =
  | "home"
  | "opportunities"
  | "matches"
  | "profile"
  | "deck"
  | "tracker"
  | "documents"
  | "notifications"
  | "whatif"
  | "quickcheck"
  | "readiness"
  | "admin";

export interface ViewProps {
  onNavigate: (view: ViewKey, params?: Record<string, unknown>) => void;
  params?: Record<string, unknown>;
}

export interface SessionUserSummary {
  id: string;
  email: string;
  name: string | null;
  role: "FOUNDER" | "REVIEWER" | "ADMIN";
  locale: string;
}

export const VIEW_LABELS: Record<ViewKey, { ar: string; en: string }> = {
  home: { ar: "الرئيسية", en: "Home" },
  opportunities: { ar: "الفرص", en: "Opportunities" },
  matches: { ar: "المطابقات", en: "Matches" },
  profile: { ar: "ملف الشركة", en: "Company Profile" },
  deck: { ar: "تحليل العرض", en: "Pitch Analysis" },
  tracker: { ar: "الطلبات", en: "Applications" },
  documents: { ar: "المستندات", en: "Documents" },
  notifications: { ar: "الإشعارات", en: "Notifications" },
  whatif: { ar: "ماذا لو", en: "What-if" },
  quickcheck: { ar: "الفحص السريع", en: "Quick Check" },
  readiness: { ar: "الجاهزية", en: "Readiness" },
  admin: { ar: "لوحة المراجعة", en: "Review Board" },
};
