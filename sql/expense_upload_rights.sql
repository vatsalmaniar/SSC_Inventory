-- Who may FILE an expense — 2026-09-08 (user rules).
--
-- TWO RULES, both given by the user:
--   1. "only those who are budgeted can upload"  -> profiles.expense_in_budget must be true
--   2. "accounts can see but not upload"         -> role 'accounts' is refused outright
--
-- Rule 2 is the stricter of the two and wins where they overlap: Jayshree Negi is accounts
-- AND budgeted, and has 3 past claims. She can no longer file. Flagged to the user.
--
-- SEEING IS UNCHANGED. exp_read still lets accounts see every sales claim plus their own —
-- they need that to run Pay Now. This only stops them CREATING one.
--
-- WHO THIS BLOCKS, measured before applying:
--   Maunang Parikh  accounts, not budgeted   9 past claims (Rs 5,271, 1 still pending)
--   Jayshree Negi   accounts, budgeted       3 past claims (Rs 2,560)
--   Bankim Mehta / Nirmita Bhoi              no claims
--   plus any future ops / fc / staff user, who are not budgeted
-- Everyone who files today — 4 admins, 2 management, 8 sales — is budgeted and unaffected.
--
-- EXISTING CLAIMS ARE NOT TOUCHED. This is INSERT-only: the 12 accounts claims already
-- filed stay exactly as they are, including the pending one awaiting approval. Approving,
-- paying and reimbursing them all still work.
--
-- NOTE for whoever reads this next: there is deliberately NO admin exemption, because the
-- user's rule was "only those who are budgeted", without one. All four admins are budgeted
-- today so nothing breaks — but toggling an admin OFF in the budget config would stop them
-- filing. Toggling them back on is the fix.

create or replace function public.expense_upload_guard() returns trigger
language plpgsql as $body$
declare v_role text; v_budgeted boolean;
begin
  select p.role, coalesce(p.expense_in_budget, false)
    into v_role, v_budgeted
    from public.profiles p
   where p.id = new.profile_id;

  if v_role = 'accounts' then
    raise exception 'Accounts can review and pay expenses, but not file them.';
  end if;

  -- ops / staff / fc / demo cannot even OPEN the Expenses page (user rule 2026-09-08),
  -- so they certainly cannot file. Checked by ROLE and not by the budget flag, because
  -- profiles.expense_in_budget DEFAULTS TO TRUE — every ops and staff user reads as
  -- "budgeted" despite never appearing in Expenses > Configure, which only lists
  -- sales and accounts (expense_budget_people). The flag alone would have let 6 ops
  -- and 9 warehouse staff file.
  if v_role is null or v_role not in ('sales','admin','management') then
    raise exception 'Your role cannot file expenses.';
  end if;

  if not v_budgeted then
    raise exception 'You are not set up to claim expenses. Ask an admin to enable you in Expenses > Configure.';
  end if;

  return new;
end $body$;

drop trigger if exists trg_expense_upload_guard on public.expenses;
create trigger trg_expense_upload_guard before insert on public.expenses
  for each row execute function public.expense_upload_guard();

-- ROLLBACK: drop trigger trg_expense_upload_guard on public.expenses;
