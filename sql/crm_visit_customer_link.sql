-- ═══════════════════════════════════════════════════════════════════════════
-- FIELD VISITS · LINK TO THE CUSTOMER, NOT TO A TYPED NAME
--
-- A visit recorded the company as free text and nothing else. company_id was
-- hardcoded to NULL on save and customer_id was never written — even though the
-- form had ALREADY captured which customer the rep picked from the typeahead.
-- All 658 visits carried a name and no link, so Customer 360 asked "which
-- visits belong to this customer" and could never answer, for any customer,
-- since the day the tab was built.
--
-- SAP models this as partner determination: an activity references a Business
-- Partner, and what you typed is resolved to that partner AT SAVE TIME. A
-- prospect is still a BP (in Prospect role), so a visit to a non-customer still
-- points at a real record, and converting a prospect is a role change on the
-- SAME record — history follows because it was never detached.
--
-- We are not making prospects master records today; that reworks how the CRM
-- captures companies. This gets the same practical outcome:
--
--   1. the form writes customer_id when a real customer is chosen  (app change)
--   2. a trigger resolves a TYPED name to a customer when it is unambiguous,
--      so a rep who types instead of selecting does not create a new orphan
--   3. a trigger links a prospect's existing visits the day that prospect
--      becomes a customer
--   4. a one-time backfill recovers the 596 historical visits that match
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- No fuzzy matching. Case and punctuation are ignored; nothing else. "Gavis
-- Elektric" and "GAVIS ELEKTRIC SYSTEMS" stay separate. A visit attached to the
-- WRONG company is worse than one attached to none, because nobody would ever
-- spot it.
--
-- No unique index on customer_name. In India the same legal name can legitimately
-- exist twice under different GSTINs, and a unique index would block a valid
-- customer. Ambiguity is handled by refusing to guess: link only when exactly
-- one customer matches.
--
-- KNOWN LIMIT, on purpose: steps 2 and 3 depend on two strings being equal, so a
-- RENAMED customer will not pick up visits logged under its old name (HCE →
-- Hicool Electronic Industries, 2026-08). Step 1 is immune because it stores an
-- id. The permanent fix is prospects as master records — logged, not pretended.
-- ═══════════════════════════════════════════════════════════════════════════

-- Case and punctuation only. Nothing clever, and used identically by the
-- backfill and both triggers so they can never disagree about what "matches".
create or replace function norm_company_name(p text)
returns text
language sql
immutable
set search_path to public, pg_temp
as $$ select lower(regexp_replace(btrim(coalesce(p,'')), '[^a-zA-Z0-9]', '', 'g')) $$;

-- The single resolver. Returns a customer id only when EXACTLY ONE customer
-- carries that name; NULL when none match and NULL when several do.
create or replace function resolve_customer_by_name(p_name text)
returns uuid
language plpgsql
stable
security definer
set search_path to public, pg_temp
as $$
declare v_id uuid; v_n int; v_norm text := norm_company_name(p_name);
begin
  if v_norm = '' then return null; end if;
  -- min(uuid) does not exist in Postgres; take the count and the row separately.
  select count(*) into v_n
    from customers where norm_company_name(customer_name) = v_norm;
  if v_n <> 1 then return null; end if;   -- 0 = genuine prospect, >1 = ambiguous
  select id into v_id
    from customers where norm_company_name(customer_name) = v_norm limit 1;
  return v_id;
end $$;

revoke execute on function resolve_customer_by_name(text) from public, anon;
grant  execute on function resolve_customer_by_name(text) to authenticated;

create index if not exists idx_customers_norm_name on customers (norm_company_name(customer_name));
create index if not exists idx_crm_field_visits_customer_id on crm_field_visits (customer_id);


-- ── 2 · partner determination at save ───────────────────────────────────────
-- The app now sends customer_id when the rep picks from the typeahead. This is
-- for when they type the name instead: resolve it rather than store an orphan.
-- Only ever FILLS a null; an explicit link is never overwritten.
create or replace function crm_visit_resolve_customer()
returns trigger
language plpgsql
set search_path to public
as $$
begin
  if new.customer_id is null then
    new.customer_id := resolve_customer_by_name(new.company_freetext);
  end if;
  return new;
end $$;

drop trigger if exists trg_visit_resolve_customer on crm_field_visits;
create trigger trg_visit_resolve_customer
  before insert or update of company_freetext, customer_id on crm_field_visits
  for each row execute function crm_visit_resolve_customer();


-- ── 3 · a prospect becomes a customer ───────────────────────────────────────
-- The nearest thing to SAP extending a Prospect BP into a Customer BP: the day
-- the name enters the master, every visit logged under it attaches. Without
-- this, a converted prospect opens with an empty Visits tab even though the rep
-- called on them four times last quarter.
create or replace function crm_link_visits_to_new_customer()
returns trigger
language plpgsql
set search_path to public
as $$
declare v_n int;
begin
  update crm_field_visits v
     set customer_id = new.id
   where v.customer_id is null
     and norm_company_name(v.company_freetext) = norm_company_name(new.customer_name)
     -- only when this is now the ONLY customer with that name
     and (select count(*) from customers c
           where norm_company_name(c.customer_name) = norm_company_name(new.customer_name)) = 1;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    raise notice 'linked % existing field visit(s) to new customer %', v_n, new.customer_name;
  end if;
  return null;
end $$;

drop trigger if exists trg_link_visits_to_new_customer on customers;
create trigger trg_link_visits_to_new_customer
  after insert on customers
  for each row execute function crm_link_visits_to_new_customer();


-- ── 4 · one-time backfill ───────────────────────────────────────────────────
-- Deterministic, like an SAP migration load: matched rows are linked, unmatched
-- rows are left alone and remain visible as an exception list. The audit trigger
-- is disabled for the duration so 596 visits do not all show a maintenance
-- timestamp from the day of the fix — a backfill is not a business event.
begin;
  alter table crm_field_visits disable trigger trg_audit_cols;

  update crm_field_visits v
     set customer_id = resolve_customer_by_name(v.company_freetext)
   where v.customer_id is null
     and resolve_customer_by_name(v.company_freetext) is not null;

  alter table crm_field_visits enable trigger trg_audit_cols;
commit;
