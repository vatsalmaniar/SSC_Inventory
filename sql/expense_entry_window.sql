-- Expense entry window — APPLIED LIVE 2026-09-05 (user rule).
--
-- THE RULE
--   An expense may be entered for the CURRENT month at any time, and for the PREVIOUS
--   month only until the 6th of this month. After the 6th, last month is closed.
--   Anything older is closed outright. ADMIN may enter any date, any time.
--
--   today 5 Sep  -> Sep ok, Aug ok (5 <= 6), Jul refused
--   today 7 Sep  -> Sep ok, Aug refused, Jul refused
--
-- Enforced HERE, in the database, on every insert path — not in the form. The form
-- previously allowed a full year back and nothing checked it, so July bills were being
-- filed on 1 September (Jyotsana: five July bills entered 1 Sep, in 22 minutes). The
-- page mirrors the window in its date picker for usability; this trigger is the gate.
--
-- Also blocks FUTURE-dated expenses: you cannot claim a cost that has not happened.
--
-- UPDATE is covered too, but only when expense_date actually moves — otherwise approving
-- or reimbursing an older claim (a legitimate act, days after the window shuts) would be
-- blocked by its own date. That distinction is the whole reason this is not a CHECK.

create or replace function public.expense_window_guard() returns trigger
language plpgsql as $body$
declare
  today      date := (now() at time zone 'Asia/Kolkata')::date;
  open_from  date;
begin
  -- Admin only — management is NOT exempt (user rule 2026-09-05).
  if public.expense_role() = 'admin' then return new; end if;

  -- On UPDATE, only re-check when the date itself is being changed; approvals,
  -- reimbursements and note edits on an older claim must still work.
  if TG_OP = 'UPDATE' and new.expense_date is not distinct from old.expense_date then
    return new;
  end if;

  open_from := case
    when extract(day from today) <= 6
      then (date_trunc('month', today) - interval '1 month')::date   -- last month still open
      else date_trunc('month', today)::date                          -- last month closed
  end;

  if new.expense_date > today then
    raise exception 'Expense date cannot be in the future.';
  end if;

  if new.expense_date < open_from then
    raise exception 'Expenses for % are closed. You can file the current month any time, and last month only until the 6th. Ask an admin to enter it.',
      to_char(new.expense_date, 'Mon YYYY');
  end if;

  return new;
end $body$;

drop trigger if exists trg_expense_window on public.expenses;
create trigger trg_expense_window before insert or update on public.expenses
  for each row execute function public.expense_window_guard();

-- VERIFIED 2026-09-05, every branch, by impersonating real sessions inside a rolled-back
-- transaction (today = 5 Sep, so August is legitimately still open):
--   USER  Sep date            -> ACCEPTED
--   USER  Aug date            -> ACCEPTED  (5 <= 6)
--   USER  Jul date            -> REFUSED   "Expenses for Jul 2026 are closed…"
--   USER  future date         -> REFUSED
--   ADMIN Mar date            -> ACCEPTED  (admin exempt)
--   owner back-dates own live claim to Apr -> REFUSED by this trigger
--   status update on an Apr claim (approve / pay / reimburse) -> ACCEPTED, unchanged
--
-- The after-the-6th branch cannot be reached by wall clock today, so it was proved by
-- evaluating open_from across the boundary: today 4/5/6 Sep -> oldest allowed 1 Aug;
-- today 7/8 Sep -> oldest allowed 1 Sep. The 6th is INCLUSIVE, as the rule was given.
--
-- Blast radius: one frontend insert (PeopleExpenses.jsx) and three RPCs that update
-- expenses — expense_review, expense_pay_bulk, expense_mark_reimbursed. All three change
-- status only, so the unchanged-date early return carries them; measured above.
-- 283 existing rows (278 dated before this month) are untouched — this fires on write only.
--
-- ROLLBACK: drop trigger trg_expense_window on public.expenses;
