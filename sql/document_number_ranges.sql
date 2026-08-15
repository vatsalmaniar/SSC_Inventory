-- ═══════════════════════════════════════════════════════════════════════════
-- DOCUMENT NUMBER RANGES
--
-- Every document series in this ERP allocated its next number with
-- `SELECT MAX(...) + 1 FROM <the documents themselves>`. That reads the
-- DOCUMENTS to decide the next number, so the moment the highest-numbered
-- document is deleted or renumbered, the next one takes its number. Two
-- documents, one number — and the second silently overwrites the first in
-- every report, every Tally export, every conversation with a customer.
--
-- SAP models this as a number range object (NRIV): a counter that belongs to
-- the SERIES, not to the documents. Allocating advances the counter and never
-- looks at what exists. Deleting a document leaves a gap, and a gap is fine —
-- SAP buffers logistics ranges precisely because gaps do not matter. Reuse
-- does.
--
-- Design notes that matter for anyone changing this later:
--
--  · ONE table and ONE allocator for every series. Seven near-identical
--    copies is how `next_grn_number` ended up with two overloads taking two
--    DIFFERENT advisory locks, which means they never locked against each
--    other at all.
--
--  · SECURITY DEFINER is not optional. The counter table is deliberately
--    read-only to users, so an INVOKER allocator inherits the caller's RLS and
--    fails with "new row violates row-level security policy" for everyone
--    except a superuser. That exact bug shipped on the PO series and was only
--    caught because a human tried to approve a PO — backend testing runs as
--    postgres, which bypasses RLS and cannot see it.
--
--  · EXECUTE is revoked from anon and PUBLIC. A definer allocator reachable by
--    a signed-out caller can be driven to burn numbers.
--
--  · Allocation must happen INSIDE the transaction that writes the document.
--    Then a refused write rolls the counter back with it and nothing is
--    consumed. The PO series burnt seven numbers by allocating in a separate
--    browser call from the one that could fail.
--
--  · No existing document is touched by any of this. The counter decides only
--    the NEXT number; every number already issued stays exactly as it is.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists doc_number_counters (
  fy         text    not null,
  doc_type   text    not null,
  last_seq   int     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (fy, doc_type)
);

comment on table doc_number_counters is
  'Number range per (financial year, document type). The counter owns the series; documents never decide their own next number. Writable only through next_doc_seq().';

alter table doc_number_counters enable row level security;

-- Readable so support can see where a series stands. Writable by nobody: the
-- only way it moves is next_doc_seq(), which runs as its owner.
drop policy if exists dnc_read on doc_number_counters;
create policy dnc_read on doc_number_counters for select to authenticated using (true);

-- ── The allocator ───────────────────────────────────────────────────────────
-- Returns the next sequence number for a series, atomically. INSERT … ON
-- CONFLICT DO UPDATE … RETURNING takes a row lock for the duration of the
-- caller's transaction, so two concurrent callers get different numbers
-- without an advisory lock and without either one waiting on a table scan.
--
-- A brand-new (fy, doc_type) starts at 1 — which is what a financial-year
-- rollover should do, and matches how the MAX+1 versions behaved because they
-- filtered by FY.
create or replace function next_doc_seq(p_doc_type text, p_fy text default null)
returns int
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare v_seq int; v_fy text := coalesce(p_fy, fy_suffix());
begin
  if p_doc_type is null or p_doc_type = '' then
    raise exception 'next_doc_seq requires a document type';
  end if;

  insert into doc_number_counters (fy, doc_type, last_seq)
  values (v_fy, p_doc_type, 1)
  on conflict (fy, doc_type) do update
    set last_seq = doc_number_counters.last_seq + 1, updated_at = now()
  returning last_seq into v_seq;

  return v_seq;
end $$;

revoke execute on function next_doc_seq(text, text) from public, anon;
grant  execute on function next_doc_seq(text, text) to authenticated;
