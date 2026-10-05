-- Optional hardening after 20261005092819_pro_demo_purchase (for the owner to run in the SQL Editor; the database
-- connector holds REVOKE statements for a human). The Supabase advisor reports start_pro_demo and stop_pro_demo as
-- «Public Can Execute SECURITY DEFINER Function»: PUBLIC and anon keep the default EXECUTE on new functions. Both
-- functions already refuse a caller without auth.uid() (errcode 42501), so this only removes the warning and the
-- needless entry point; signed-in users keep EXECUTE through the explicit grant to authenticated.
-- Check afterwards: supabase/tests/pro_demo_purchase.sql (contract_ok stays true; anon_execute becomes false).
revoke execute on function public.start_pro_demo() from public, anon;
revoke execute on function public.stop_pro_demo() from public, anon;
