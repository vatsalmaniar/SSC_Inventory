-- ═══════════════════════════════════════════════════════════════════════════
-- A PO number, once issued, is permanent.        (applied 2026-08-05)
--
-- The UI fix in PurchaseOrderDetail.handleApprove() stops the known cause, but
-- a PO number is a document identity the vendor holds — it must not depend on
-- any single code path staying correct. This is the backstop.
--
-- Allowed:   Temp/PO0049  → SSC/PO0241   (first approval mints the real number)
-- Blocked:   SSC/PO0185   → SSC/PO0232   (renaming an issued PO)
-- Blocked:   SSC/PO0185   → Temp/...     (un-issuing a number)
--
-- TESTED 2026-08-05 (all three in a rolled-back transaction):
--   A  SSC/PO0185 → SSC/PO9999   rejected, 23514, with an explanatory message
--   B  Temp/PO0049 → SSC/PO9998  allowed (first approval still works)
--   C  unrelated UPDATE on an issued PO  unaffected
--
-- NOTE ON THE service_role ESCAPE HATCH: it does NOT fire over the Management
-- API / a direct postgres connection, because request.jwt.claim.role is empty
-- there — the trigger blocks those too. That is the safer default, but it means
-- a genuine admin correction must be explicit about overriding the guard:
--
--   BEGIN;
--     ALTER TABLE public.purchase_orders DISABLE TRIGGER trg_po_number_immutable;
--     UPDATE public.purchase_orders SET po_number = '...' WHERE id = '...';
--     ALTER TABLE public.purchase_orders ENABLE  TRIGGER trg_po_number_immutable;
--   COMMIT;
--
-- Deliberate: changing an issued PO number should require someone to knowingly
-- switch off a guard, not happen as a side effect of an ordinary UPDATE.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.po_number_is_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.po_number IS DISTINCT FROM OLD.po_number
     AND OLD.po_number IS NOT NULL
     AND OLD.po_number NOT LIKE 'Temp/%'
  THEN
    -- service_role (migrations, admin SQL) may still correct a genuine mistake.
    IF COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'PO number % is already issued and cannot be changed (attempted: %). The vendor holds this number. Amend the PO instead — re-approval keeps the same number.',
      OLD.po_number, NEW.po_number
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_po_number_immutable ON public.purchase_orders;
CREATE TRIGGER trg_po_number_immutable
  BEFORE UPDATE OF po_number ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.po_number_is_immutable();
