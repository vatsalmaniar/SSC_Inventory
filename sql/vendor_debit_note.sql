-- ═══════════════════════════════════════════════════════════════════════════
-- VENDOR DEBIT NOTE — closing out a variance in the vendor's favour
--
-- Mirrors sql/grn_credit_note.sql exactly, including its philosophy:
-- ACCOUNTING LIVES IN TALLY. The system only TRIGGERS the debit-note step and
-- stores the resulting document. Same shape, same four columns, same "pending
-- until number + file are uploaded" behaviour.
--
-- WHY THIS EXISTS. Without it, refusing an over-delivery is a dead end:
--
--   PO 100 @ 132.76, 110 arrive, you send 10 back.
--   The GRN records 110 received / 100 accepted / 10 returned.  ✓
--   The match expects 100 x 132.76 = 13,276 and the vendor bills 110 = 14,603.60,
--   so it flags a +1,327.60 quantity variance.                  ✓
--   ...and then nothing. You are paying for 100 against a bill for 110, with no
--   document raising the 1,327.60 back against the vendor.       ✗
--
-- The existing credit-note machinery is CUSTOMER-side only — grn_type in
-- ('customer_rejection','cancellation_return'), surfaced on PurchaseInvoiceList's
-- "Credit / Dr Notes" tab. There is no vendor equivalent anywhere:
-- `grep -rn "vendor_return|return_to_vendor|debit_note"` finds nothing.
--
-- NO NUMBERING RPC. Like the credit note, the number comes FROM TALLY and is
-- transcribed here. This is deliberately not a next_doc_seq series: the
-- authoritative document is the Tally one, and minting a second number would
-- create two identities for one piece of paper.
--
-- ⛔ NO DATA IS DELETED. Four ADD COLUMN IF NOT EXISTS on purchase_invoices,
--    all nullable, plus one nullable amount. No existing row is read or written.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.purchase_invoices
  -- Raised when a variance is overridden in a direction that means the vendor
  -- owes money back (a quantity variance, or rejected goods still billed).
  add column if not exists debit_note_required    boolean not null default false,
  add column if not exists debit_note_amount      numeric,
  add column if not exists debit_note_raised_at   timestamptz,   -- start of the 48h SLA
  add column if not exists debit_note_raised_by   text,
  -- The Tally document, transcribed and attached.
  add column if not exists debit_note_number      text,
  add column if not exists debit_note_url         text,
  add column if not exists debit_note_uploaded_by text,
  add column if not exists debit_note_uploaded_at timestamptz;   -- end of the SLA

comment on column public.purchase_invoices.debit_note_required is
  'True when a variance was overridden in a direction that means the vendor owes money back. The bill shows "Debit note pending" until number + file are uploaded. Accounting is Tally''s — this only triggers and tracks the step.';
comment on column public.purchase_invoices.debit_note_amount is
  'What to recover. Normally the quantity variance (billed qty above accepted qty x rate), not the whole difference: a rate variance usually means OUR PO price was wrong, which is not the vendor''s debt.';

-- The work queue: raised but not yet uploaded.
create index if not exists idx_pi_debit_note_pending
  on public.purchase_invoices (debit_note_raised_at)
  where debit_note_required and debit_note_uploaded_at is null;


-- ── Raise the debit note ───────────────────────────────────────────────────
-- Separate from the override so the two decisions stay distinct: releasing a
-- bill for payment is one act, deciding the vendor owes money back is another.
create or replace function public.pi_raise_debit_note(
  p_invoice_id uuid,
  p_amount     numeric,
  p_reason     text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_inv record; v_actor record; v_cfg record;
begin
  select * into v_actor from public.tw_actor();
  if v_actor.uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  select * into v_cfg from public.three_way_tolerance where id = 1;
  -- Same authority as releasing a bill: this asserts a claim against a vendor.
  if not (v_actor.role = any (v_cfg.override_roles)) then
    raise exception 'Only % can raise a debit note against a vendor.',
      array_to_string(v_cfg.override_roles, ' or ') using errcode = '42501';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'A debit note needs an amount to recover.' using errcode = '23514';
  end if;

  select * into v_inv from public.purchase_invoices where id = p_invoice_id for update;
  if v_inv is null then
    raise exception 'Bill not found.' using errcode = 'P0002';
  end if;
  if v_inv.debit_note_raised_at is not null then
    return jsonb_build_object('already_raised', true,
                              'amount', v_inv.debit_note_amount,
                              'raised_by', v_inv.debit_note_raised_by);
  end if;

  update public.purchase_invoices set
    debit_note_required  = true,
    debit_note_amount    = p_amount,
    debit_note_raised_at = now(),
    debit_note_raised_by = v_actor.name,
    payment_block        = true,   -- do not pay in full while money is owed back
    updated_at           = now()
  where id = p_invoice_id;

  insert into public.three_way_match_log (invoice_id, grn_id, invoice_number, vendor_id,
    vendor_name, event, reason, actor_id, actor_name, actor_role, would_block, variance_amount)
  values (p_invoice_id, v_inv.grn_id, v_inv.invoice_number, v_inv.vendor_id, v_inv.vendor_name,
    'debit_note_raised', btrim(coalesce(p_reason, '')), v_actor.uid, v_actor.name, v_actor.role,
    false, p_amount);

  return jsonb_build_object('debit_note_required', true, 'amount', p_amount);
end $$;


-- ── Attach the Tally document ──────────────────────────────────────────────
create or replace function public.pi_attach_debit_note(
  p_invoice_id uuid,
  p_number     text,
  p_url        text
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_inv record; v_actor record;
begin
  select * into v_actor from public.tw_actor();
  if v_actor.uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  -- Accounts transcribes the Tally document; they do not need override rights
  -- to do the clerical half.
  if not public.is_procurement_writer() then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_number), '') = '' then
    raise exception 'Enter the debit note number from Tally.' using errcode = '23514';
  end if;

  select * into v_inv from public.purchase_invoices where id = p_invoice_id for update;
  if v_inv is null then
    raise exception 'Bill not found.' using errcode = 'P0002';
  end if;
  if not v_inv.debit_note_required then
    raise exception 'No debit note has been raised on this bill.' using errcode = '23514';
  end if;

  update public.purchase_invoices set
    debit_note_number      = btrim(p_number),
    debit_note_url         = p_url,
    debit_note_uploaded_by = v_actor.name,
    debit_note_uploaded_at = now(),
    updated_at             = now()
  where id = p_invoice_id;

  return jsonb_build_object('attached', true, 'number', btrim(p_number));
end $$;

revoke all on function public.pi_raise_debit_note(uuid,numeric,text)  from public, anon;
revoke all on function public.pi_attach_debit_note(uuid,text,text)    from public, anon;
grant execute on function public.pi_raise_debit_note(uuid,numeric,text) to authenticated;
grant execute on function public.pi_attach_debit_note(uuid,text,text)   to authenticated;

commit;

-- The pending queue, for the list page and the SLA:
--   select invoice_number, vendor_name, debit_note_amount, debit_note_raised_at,
--          round(extract(epoch from (now() - debit_note_raised_at))/3600, 1) as age_hours
--     from public.purchase_invoices
--    where debit_note_required and debit_note_uploaded_at is null
--    order by debit_note_raised_at;
