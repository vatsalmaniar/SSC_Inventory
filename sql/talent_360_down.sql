-- ═══════════════════════════════════════════════════════════════════════════
-- TALENT 360 — ROLLBACK for sql/talent_360_up.sql
--
-- Drops ONLY the objects that migration created. Nothing that pre-dated it is
-- touched.
--
-- ⚠️ THIS DESTROYS HIRING DATA. Every requisition, candidate, CV reference,
--    interview scorecard, reference check and offer goes with it. Run it only
--    to unwind a failed install, never to "tidy up" — and take a backup first.
--
-- DELIBERATELY NOT REVERSED — two things are left in place on purpose:
--
--  1. notifications.recipient_email / recipient_name. They are nullable,
--     unused by every existing code path, and cost nothing to leave. Dropping
--     a column off a live, heavily-written table to undo an install that added
--     nothing to it is the riskier move.
--
--  2. The 'OFR' and 'REQ' rows in doc_number_counters. Deleting the OFR row
--     would restart offer numbering at 1 and re-issue numbers that have
--     already gone out to real people on real letters. Gaps are fine; reuse
--     is not. Leave both.
--
-- The storage buckets are emptied of policies but the buckets and any objects
-- inside them are NOT deleted — see the note at the bottom.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Storage policies (created by the up migration) ──────────────────────────
drop policy if exists "talentdoc_insert" on storage.objects;
drop policy if exists "talentdoc_read"   on storage.objects;
drop policy if exists "talentdoc_update" on storage.objects;
drop policy if exists "talentdoc_delete" on storage.objects;
drop policy if exists "empdoc_insert"    on storage.objects;
drop policy if exists "empdoc_read"      on storage.objects;
drop policy if exists "empdoc_update"    on storage.objects;
drop policy if exists "empdoc_delete"    on storage.objects;

-- ── Offer number formatter ──────────────────────────────────────────────────
-- next_doc_seq() itself is shared infrastructure and stays.
-- The write API (section 18 of the up migration).
drop function if exists public.create_job_requisition(text,text,integer,text,text,numeric,numeric,text,date,text,boolean);
drop function if exists public.decide_requisition(uuid,boolean,text);
drop function if exists public.create_job_opening(text,uuid,text,text,text,text,numeric,numeric,integer,text,boolean);
drop function if exists public.set_opening_status(uuid,text);
drop function if exists public.add_candidate_application(uuid,text,text,text,text,text,text,numeric,numeric,numeric,integer,text,text,text,boolean);
drop function if exists public.move_application_stage(uuid,text,text);
drop function if exists public.upsert_interview(uuid,integer,text,timestamptz,uuid,text,integer,jsonb,text,uuid);
drop function if exists public.upsert_reference_check(uuid,text,text,text,text,text,text,text,uuid);
drop function if exists public.add_talent_document(uuid,text,text,text,uuid,uuid);
drop function if exists public.add_talent_comment(uuid,text);
drop function if exists public.set_offer_status(uuid,text,text);
drop function if exists public.complete_offer_join(uuid,uuid);
drop function if exists public.create_offer(uuid,text,text,text,date,text,date,numeric,text,text,boolean,numeric,numeric,jsonb,boolean,text,integer,numeric);
drop function if exists public.revise_offer(uuid,numeric,text,text,boolean,numeric,numeric,jsonb,text,numeric);
drop function if exists public.talent_guard();
drop function if exists public.generate_offer_number(text);
drop function if exists public.generate_requisition_number(text);

-- ── Tables — child first, so the FKs unwind cleanly ─────────────────────────
-- (cascade would do it, but naming the order documents the graph)
drop table if exists public.talent_comments   cascade;
drop table if exists public.talent_documents  cascade;
drop table if exists public.offer_versions    cascade;
drop table if exists public.offers            cascade;
drop table if exists public.reference_checks  cascade;
drop table if exists public.interviews        cascade;
drop table if exists public.applications      cascade;
drop table if exists public.candidates        cascade;
drop table if exists public.job_openings      cascade;
drop table if exists public.job_requisitions  cascade;

-- Indexes, RLS policies and the trg_audit_cols triggers all lived ON those
-- tables, so they went with them. set_audit_cols() and expense_role() are
-- shared and stay.

-- ── Buckets — MANUAL, and only when you mean it ─────────────────────────────
-- Left in place deliberately: dropping a bucket that still holds objects
-- either fails or orphans files, and these hold CVs and signed offer letters.
-- To remove them, empty the buckets first, then:
--
--   delete from storage.buckets where id in ('talent-docs','employee-docs');
--
-- employee-docs in particular may be shared with the People 360 Documents tab
-- by then — check before deleting it.
