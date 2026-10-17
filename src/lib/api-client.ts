/**
 * Masar — same-origin API client. Session material stays in httpOnly cookies.
 * Errors are translated by stable API error code so English UI never leaks Arabic server text.
 */
export interface ApiErrorShape {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const EN_ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "Please sign in again to continue.",
  FORBIDDEN: "You do not have permission to perform this action.",
  CSRF: "The request could not be verified. Refresh the page and try again.",
  INTERNAL: "An unexpected server error occurred. Please try again.",
  BAD_JSON: "The request body is not valid JSON.",
  VALIDATION: "Some submitted information is invalid. Review the highlighted fields.",
  NO_PROFILE: "Create your startup profile before continuing.",
  EMAIL_TAKEN: "An account with this email already exists.",
  INVALID_CREDENTIALS: "The email or password is incorrect.",
  TOO_MANY_ATTEMPTS: "Too many attempts. Wait a moment before trying again.",
  EMAIL_INVALID: "Enter a valid email address.",
  PASSWORD_WEAK: "Use a stronger password with at least 8 characters.",
  NAME_REQUIRED: "Enter a name with at least 2 characters.",
  BAD_MULTIPART: "The upload request is invalid. Please retry.",
  NO_FILE: "Choose a PDF or PPTX file first.",
  TOO_LARGE: "The file exceeds the 20 MB upload limit.",
  EMPTY_FILE: "The uploaded file is empty.",
  BAD_TYPE: "Only PDF and PPTX files are supported.",
  BAD_VERSION: "The version number is invalid.",
  VERSION_NOT_FOUND: "This deck version could not be found.",
  NOT_PARTIAL: "Retry is only available for partially processed versions.",
  NO_SLIDES: "No readable slides are stored for this version. Upload the file again.",
  DB_UNAVAILABLE: "The database is temporarily unavailable.",
  OPPORTUNITY_DATABASE_UNAVAILABLE: "The opportunity catalogue is temporarily unavailable.",
  AI_PROVIDER_NOT_CONFIGURED: "AI review is not configured yet.",
  PITCH_ANALYZER_UNAVAILABLE: "The pitch-analysis service is unavailable. Please retry later.",
};

function currentLanguage(): "ar" | "en" {
  if (typeof document === "undefined") return "ar";
  return document.documentElement.lang === "en" ? "en" : "ar";
}
function isArabicText(value: string): boolean {
  return /[؀-ۿ]/.test(value);
}
function errorMessage(error: ApiErrorShape | undefined, status: number, action: "request" | "upload"): string {
  const lang = currentLanguage();
  const fallbackAr = action === "upload" ? `فشل الرفع (${status})` : `فشل الطلب (${status})`;
  const fallbackEn = action === "upload" ? `Upload failed (${status})` : `Request failed (${status})`;
  if (lang === "en") {
    if (error?.code && EN_ERROR_MESSAGES[error.code]) return EN_ERROR_MESSAGES[error.code];
    if (error?.message && !isArabicText(error.message)) return error.message;
    return fallbackEn;
  }
  return error?.message || fallbackAr;
}

async function request<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  let payload: { ok: boolean; data?: T; error?: ApiErrorShape } | null = null;
  try { payload = await res.json(); } catch { payload = null; }
  if (!res.ok || !payload?.ok) {
    const code = payload?.error?.code ?? `HTTP_${res.status}`;
    throw new ApiClientError(code, errorMessage(payload?.error, res.status, "request"), res.status, payload?.error?.details);
  }
  return payload.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  upload: async <T>(path: string, file: File): Promise<T> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/v1${path}`, { method: "POST", body: form, credentials: "same-origin" });
    let payload: { ok: boolean; data?: T; error?: ApiErrorShape } | null = null;
    try { payload = await res.json(); } catch { payload = null; }
    if (!res.ok || !payload?.ok) {
      const code = payload?.error?.code ?? `HTTP_${res.status}`;
      throw new ApiClientError(code, errorMessage(payload?.error, res.status, "upload"), res.status, payload?.error?.details);
    }
    return payload.data as T;
  },
};
