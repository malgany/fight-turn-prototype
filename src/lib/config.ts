import { Capacitor } from "@capacitor/core";

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const configuredPublicAppUrl = import.meta.env.VITE_PUBLIC_APP_URL as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const mobileAuthRedirectUrl = "com.malganiplay.finalgenesis://auth/callback";
const fallbackPublicAppUrl = "https://final-genesis-web.vercel.app";

export function isNativeMobileApp(): boolean {
  return Capacitor.isNativePlatform();
}

export function authRedirectUrl(): string {
  if (isNativeMobileApp()) return mobileAuthRedirectUrl;
  return `${window.location.origin}/auth/callback`;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

export function publicAppOrigin(): string {
  if (configuredPublicAppUrl) return trimTrailingSlashes(configuredPublicAppUrl);
  if (isNativeMobileApp()) return fallbackPublicAppUrl;
  const origin = window.location.origin;
  return origin && origin !== "null" ? trimTrailingSlashes(origin) : fallbackPublicAppUrl;
}

export function privateRoomInviteUrl(code: string): string {
  return new URL(`online/?room=${encodeURIComponent(code.toUpperCase())}`, `${publicAppOrigin()}/`).href;
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
