import { Capacitor } from "@capacitor/core";

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const mobileAuthRedirectUrl = "com.malganiplay.finalgenesis://auth/callback";

export function isNativeMobileApp(): boolean {
  return Capacitor.isNativePlatform();
}

export function authRedirectUrl(): string {
  if (isNativeMobileApp()) return mobileAuthRedirectUrl;
  return `${window.location.origin}/auth/callback/`;
}

export function appRouteUrl(path: string): string {
  const normalizedPath = path.replace(/^\/+/, "");
  const origin = window.location.origin;
  if (origin && origin !== "null") {
    return new URL(normalizedPath, `${origin}/`).href;
  }
  const pathname = window.location.pathname.replace(/\\/g, "/");
  const base = pathname.includes("/online/")
    ? new URL("../", window.location.href)
    : pathname.includes("/auth/callback/")
      ? new URL("../../", window.location.href)
      : new URL("./", window.location.href);
  return new URL(normalizedPath || "index.html", base).href;
}
