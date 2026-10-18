import { createClient } from '@supabase/supabase-js';
import { createSupabaseFetch } from './supabaseRoute';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://daunnytubqbzafjnpfnw.supabase.co';
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhdW5ueXR1YnFiemFmam5wZm53Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMzUxMDQsImV4cCI6MjA5NDYxMTEwNH0.1VLX3fW8NSmXlP6yknWbwslyrMMkc9TgA-oP3T_NzWE';

// The fetch picks the way to Supabase: direct, or through the Meldy site when *.supabase.co is
// unreachable (lib/supabaseRoute.ts). The auth storage key still comes from supabaseUrl. Exported for the one call
// that is not the client's own (api/itemPictures.ts guestPictureUrl): it takes the same way the client chose.
export const supabaseFetch = createSupabaseFetch({ supabaseUrl, anonKey: supabaseAnonKey });

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: supabaseFetch },
});
