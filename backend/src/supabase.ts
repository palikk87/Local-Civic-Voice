import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY ?? "";

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn("Supabase credentials not configured in backend");
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export const isSupabaseConfigured = (): boolean => {
  return Boolean(
    supabaseUrl &&
      supabaseServiceKey &&
      supabaseUrl.startsWith("https://") &&
      supabaseServiceKey.length > 20
  );
};
