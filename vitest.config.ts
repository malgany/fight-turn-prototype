import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "https://esm.sh/@supabase/supabase-js@2.108.1": "@supabase/supabase-js",
    },
  },
});
