import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://daunnytubqbzafjnpfnw.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhdW5ueXR1YnFiemFmam5wZm53Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMzUxMDQsImV4cCI6MjA5NDYxMTEwNH0.1VLX3fW8NSmXlP6yknWbwslyrMMkc9TgA-oP3T_NzWE';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
