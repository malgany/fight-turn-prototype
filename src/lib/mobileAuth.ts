import type { SupabaseClient } from "@supabase/supabase-js";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { appRouteUrl, isNativeMobileApp, mobileAuthRedirectUrl } from "./config";
import { supabase } from "./supabase";

function paramsFromUrl(url: string): URLSearchParams {
  const parsed = new URL(url);
  const params = new URLSearchParams(parsed.search);
  const hashParams = new URLSearchParams(parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash);
  hashParams.forEach((value, key) => params.set(key, value));
  return params;
}

async function finishMobileAuth(url: string): Promise<void> {
  if (!supabase || !url.startsWith(mobileAuthRedirectUrl)) return;

  const params = paramsFromUrl(url);
  const errorCode = params.get("error_code") || params.get("error");
  if (errorCode) throw new Error(errorCode);

  const code = params.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
  } else {
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken || !refreshToken) return;

    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
  }

  window.location.replace(appRouteUrl("online/"));
}

export function setupMobileAuthRedirect(): void {
  if (!isNativeMobileApp()) return;

  void App.addListener("appUrlOpen", (event) => {
    void Browser.close().catch(() => {});
    void finishMobileAuth(event.url).catch((error) => {
      console.error("Mobile auth callback failed", error);
      window.location.replace(appRouteUrl("online/"));
    });
  });
}

export async function signInWithGoogleOnMobile(client: SupabaseClient, redirectTo: string): Promise<void> {
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  if (!data.url) throw new Error("URL de login Google ausente.");

  await Browser.open({ url: data.url });
}
