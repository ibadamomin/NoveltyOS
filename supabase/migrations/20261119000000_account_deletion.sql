-- Self-service account deletion (required by Google Play and Apple for apps with sign-up).
--
-- Deletes the signed-in user's login. Businesses the user OWNS are deleted together with all
-- their records (products, sales, customers, payments, ...) via ON DELETE CASCADE.
-- If the user is only STAFF in a business, just their membership goes; the business stays.

create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in'; end if;
  delete from public.businesses b
   where exists (select 1 from public.members m
                  where m.business_id = b.id and m.user_id = uid and m.role = 'owner');
  delete from auth.users where id = uid;   -- cascades to memberships and login sessions
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
