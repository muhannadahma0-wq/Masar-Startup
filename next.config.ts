import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Keep TypeScript build errors visible: production builds must not mask type failures.
  reactStrictMode: true,
  // بيئة المعاينة: المتصفح يفتح التطبيق عبر preview-*.space-z.ai بينما خادم
  // التطوير يرى Host داخليًا — نسمح بأصول منصة المعاينة لأصول التطوير (HMR
  // و_next/*) وإلا ظهر تحذير cross-origin وانقطع التحديث الحي.
  allowedDevOrigins: ["*.space-z.ai"],
};

export default nextConfig;
