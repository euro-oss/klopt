-- Make `updated_at` mean something (spec 10.2, ADR 0053).
--
-- Every one of these tables already had the column, from the shared
-- `timestamps` builder — and every one of them only ever set it on insert.
-- Nothing bumped it on update, so `updated_at` has always equalled
-- `created_at`, and an `updated_since` filter built on it would have silently
-- returned nothing for rows that had in fact changed. A column that looks
-- right and is never maintained is worse than an absent one.
--
-- A trigger rather than repository code. A repository that forgets leaves a
-- row that never appears in an incremental sync again, and the caller sees a
-- successful response with the stale row simply missing — no error, no clue.
-- A trigger cannot be forgotten by a code path written next year.
--
-- Only the four resources that change in place. The append-only ones need
-- nothing: a journal entry never moves, so its cursor is already the whole of
-- "what is new".

CREATE OR REPLACE FUNCTION klopt.touch_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

--> statement-breakpoint

CREATE TRIGGER contacts_touch_updated_at
  BEFORE UPDATE ON klopt.contacts
  FOR EACH ROW EXECUTE FUNCTION klopt.touch_updated_at();

--> statement-breakpoint

CREATE TRIGGER sales_invoices_touch_updated_at
  BEFORE UPDATE ON klopt.sales_invoices
  FOR EACH ROW EXECUTE FUNCTION klopt.touch_updated_at();

--> statement-breakpoint

CREATE TRIGGER bank_transactions_touch_updated_at
  BEFORE UPDATE ON klopt.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION klopt.touch_updated_at();

--> statement-breakpoint

CREATE TRIGGER purchase_invoices_touch_updated_at
  BEFORE UPDATE ON klopt.purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION klopt.touch_updated_at();

--> statement-breakpoint

-- The index the filter reads. Per entity, because every list is scoped to one
-- and a cross-tenant scan is both slow and the wrong shape.
CREATE INDEX IF NOT EXISTS contacts_entity_updated
  ON klopt.contacts (entity_id, updated_at);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS sales_invoices_entity_updated
  ON klopt.sales_invoices (entity_id, updated_at);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS bank_transactions_entity_updated
  ON klopt.bank_transactions (entity_id, updated_at);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS purchase_invoices_entity_updated
  ON klopt.purchase_invoices (entity_id, updated_at);
