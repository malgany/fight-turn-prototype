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
  return `${window.location.origin}/auth/callback`;
}
