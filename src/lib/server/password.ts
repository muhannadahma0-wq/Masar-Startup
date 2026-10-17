/**
 * Masar — تجزئة كلمات المرور والتحقق منها (T9)
 * ---------------------------------------------------------------------------
 * scrypt من node:crypto بمعاملات N=16384, r=8, p=1 (تكيف البيئة: argon2id غير
 * مثبّت — موثّق في AGENT_CONTRACT §2) وملح عشوائي 16 بايت لكل تجزئة.
 *
 * الصيغة المخزنة (نص hex): `scrypt$<salt 32 hex>$<hash 128 hex>`
 *
 * ضمانات:
 * - التحقق بمقارنة زمن ثابت (timingSafeEqual) — لا تسريب معلومات بالمقارنة.
 * - verifyPassword لا يرمي استثناءً أبدًا: أي سلسلة مخزنة تالفة/بصيغة غير
 *   متوقعة (أجزاء ناقصة، hex غير صالح، أطوال خاطئة، خوارزمية أخرى) تُعيد
 *   false فحسب. كلمات المرور ورموز الجلسات لا تُطبع ولا تُسجَّل في أي مكان.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64; // بايت → 128 محرفًا hex
const SALT_LEN = 16; // بايت → 32 محرفًا hex

// 128*N*r = 16MB — داخل حد maxmem الافتراضي (32MB)، يُمرَّر صريحًا للوضوح.
const SCRYPT_OPTS = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 };

/**
 * تجزئة كلمة مرور: scrypt(N=16384,r=8,p=1) + ملح عشوائي 16B.
 * الناتج: "scrypt$saltHex$hashHex" — ملح مختلف في كل استدعاء.
 */
export function hashPassword(pw: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(pw, salt, KEY_LEN, SCRYPT_OPTS);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/**
 * التحقق من كلمة مرور مقابل السلسلة المخزنة "scrypt$salt$hash".
 * مقارنة زمن ثابت (timingSafeEqual). السلسلة التالفة/غير المتوقعة → false
 * بلا استثناء. لا يعيد true إلا عند تطابق كامل.
 */
export function verifyPassword(pw: string, stored: string): boolean {
  try {
    if (typeof pw !== "string" || typeof stored !== "string") return false;
    const parts = stored.split("$");
    if (parts.length !== 3 || parts[0] !== "scrypt") return false;
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    // Buffer.from(hex) يقتطع بصمت عند محارف غير صالحة — التحقق من الأطوال
    // بعد التحويل يرفض أي hex ناقص/تالف (طول 0 أو غير متوقع).
    if (salt.length !== SALT_LEN || expected.length !== KEY_LEN) return false;
    const actual = scryptSync(pw, salt, expected.length, SCRYPT_OPTS);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
