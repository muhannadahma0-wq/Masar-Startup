import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const plexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-app",
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "مسار | Masar — فرص تمويل موثّقة وأهلية مفسّرة",
  description:
    "منصة «مسار» تساعد المؤسسين الفلسطينيين على معرفة الفرص التي يحق لهم التقديم إليها فعلًا، ولماذا، وما الذي ينقصهم قبل التقديم. محرك أهلية حتمي بأدلة، وتحليل عروض بتأكيد المؤسس، ومتتبع طلبات.",
  keywords: ["مسار", "Masar", "فرص تمويل", "مؤسسون فلسطينيون", "أهلية", "حاضنات", "مسرّعات"],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f3d2e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body
        className={`${plexArabic.variable} font-sans antialiased bg-background text-foreground min-h-screen flex flex-col`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
