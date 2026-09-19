-- ═══════════════════════════════════════════════════════════════════════════
-- QUANTITIES ARE FROZEN ONCE A GRN IS CONFIRMED — found by red-teaming
--
-- THE BREACH. Signed in as accounts, through PostgREST:
--
--   update grn_items set accepted_qty = 1 where id = '…';   -- 18 -> 1, accepted
--
-- on a GRN that was already CONFIRMED. Three things break at once:
--   * confirm_grn has already added the OLD figure to po_items.received_qty, so
--     the GRN and the PO now disagree and nothing reconciles them;
--   * "quantity is decided at the GRN, price at Inward Billing" — the control
--     this whole change is built on — is gone, because accounts can reshape the
--     quantity to match whatever the vendor billed;
--   * a re-match would price against a quantity nobody received.
--
-- GRNDetail already says the quiet part: editing after confirmation "would need
-- a reversal RPC — out of scope for v1". The UI honours that. The database did
-- not, and PostgREST does not go through the UI.
--
-- A TRIGGER, NOT A GRANT. The rule is state-dependent — admin and management
-- legitimately edit quantities while a GRN is draft or checking — so a column
-- REVOKE would break the edit screen. What must be impossible is changing them
-- AFTER the PO has been credited.
--
-- ⛔ NO DATA IS DELETED. One function and one trigger.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.grn_items_freeze_after_confirm()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_status text;
begin
  select g.status into v_status from public.grn g where g.id = new.grn_id;

  -- Draft and checking stay editable; that is the whole point of the check step.
  if v_status not in ('confirmed','invoice_matched','inward_posted') then
    return new;
  end if;

  if new.received_qty is distinct from old.received_qty
     or new.accepted_qty is distinct from old.accepted_qty
     or new.rejected_qty is distinct from old.rejected_qty then
    raise exception
      'Quantities on % are fixed — the GRN is confirmed and the PO has already been credited with them. Void the GRN and raise a new one if the count was wrong.',
      old.item_code
      using errcode = '42501';
  end if;

  return new;   -- rejection_reason and the like stay editable
end $$;

drop trigger if exists trg_grn_items_freeze on public.grn_items;
create trigger trg_grn_items_freeze
  before update on public.grn_items
  for each row
  execute function public.grn_items_freeze_after_confirm();

revoke all on function public.grn_items_freeze_after_confirm() from public, anon;

commit;
