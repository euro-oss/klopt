-- Ledger invariants, enforced by the database.
--
-- The application enforces all of these too, and gives far better error
-- messages when it does. The duplication is the point: the application's
-- version is a good experience, this one is a guarantee. It holds for a psql
-- session, a botched migration, a future module that forgot the posting API,
-- and anyone who has the connection string.
--
-- Written by hand rather than generated: drizzle-kit does not model triggers,
-- and these are not optional decoration.

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 1. Append-only (spec 6.2)
--
-- "No UPDATE or DELETE on posted entries. Enforce with database permissions and
-- a trigger, not politeness."
--
-- Corrections are reversals. If you are reaching for an UPDATE here, the thing
-- you want is another entry.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION klopt.reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'klopt: % on %.% is refused: the journal is append-only. Post a reversal instead.',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

--> statement-breakpoint

CREATE TRIGGER journal_entries_append_only
  BEFORE UPDATE OR DELETE ON klopt.journal_entries
  FOR EACH ROW EXECUTE FUNCTION klopt.reject_mutation();

--> statement-breakpoint

CREATE TRIGGER journal_lines_append_only
  BEFORE UPDATE OR DELETE ON klopt.journal_lines
  FOR EACH ROW EXECUTE FUNCTION klopt.reject_mutation();

--> statement-breakpoint

CREATE TRIGGER journal_line_dimensions_append_only
  BEFORE UPDATE OR DELETE ON klopt.journal_line_dimensions
  FOR EACH ROW EXECUTE FUNCTION klopt.reject_mutation();

--> statement-breakpoint

-- The audit log is evidence. Same rule.
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON klopt.audit_log
  FOR EACH ROW EXECUTE FUNCTION klopt.reject_mutation();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Balanced per entry, per currency (spec 6.2)
--
-- A DEFERRABLE constraint trigger, checked at COMMIT: the entry and its lines
-- arrive as separate statements, so an immediate check would fire against a
-- half-inserted entry. Deferring means an unbalanced entry can exist inside a
-- transaction and can never survive one.
--
-- What "balanced" means, precisely:
--
--   * The functional-currency total must be zero. Always. This is the
--     authoritative invariant and the one the reports rest on.
--   * A single-currency entry must also balance in that currency, which is what
--     catches a typo or a wrong rate.
--   * A cross-currency entry is exempt from the second check, because it cannot
--     satisfy it: paying a USD 100 invoice from a EUR account debits USD 100 and
--     credits EUR 92, and the USD side has nothing to balance against.
--
-- @klopt/core applies the identical rule, and explains it at more length in
-- packages/core/src/ledger/validation.ts.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION klopt.check_entry_balanced() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  -- The same function is attached to journal_entries (where the entry id is
  -- `id`) and journal_lines (where it is `entry_id`). Going through jsonb
  -- reads whichever exists without a branch that only compiles on one table.
  target_entry uuid := COALESCE(
    (to_jsonb(NEW) ->> 'entry_id')::uuid,
    (to_jsonb(NEW) ->> 'id')::uuid
  );
  line_count integer;
  currency_count integer;
  offending record;
BEGIN
  SELECT count(*), count(DISTINCT currency)
    INTO line_count, currency_count
  FROM klopt.journal_lines
  WHERE entry_id = target_entry;

  IF line_count < 2 THEN
    RAISE EXCEPTION
      'klopt: entry % has % line(s): an entry needs at least two, because one cannot balance.',
      target_entry, line_count
      USING ERRCODE = 'check_violation';
  END IF;

  IF currency_count = 1 THEN
    SELECT currency,
           sum(debit_minor_units - credit_minor_units) AS difference
      INTO offending
    FROM klopt.journal_lines
    WHERE entry_id = target_entry
    GROUP BY currency
    HAVING sum(debit_minor_units - credit_minor_units) <> 0
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION
        'klopt: entry % does not balance in %: debits minus credits is % minor units.',
        target_entry, offending.currency, offending.difference
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT sum(functional_debit_minor_units - functional_credit_minor_units) AS difference
    INTO offending
  FROM klopt.journal_lines
  WHERE entry_id = target_entry
  HAVING sum(functional_debit_minor_units - functional_credit_minor_units) <> 0;

  IF FOUND THEN
    RAISE EXCEPTION
      'klopt: entry % does not balance in the functional currency: difference is % minor units.',
      target_entry, offending.difference
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

--> statement-breakpoint

CREATE CONSTRAINT TRIGGER journal_entries_balanced
  AFTER INSERT ON klopt.journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION klopt.check_entry_balanced();

--> statement-breakpoint

CREATE CONSTRAINT TRIGGER journal_lines_balanced
  AFTER INSERT ON klopt.journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION klopt.check_entry_balanced();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Line consistency with its entry
--
-- A line's entity and period must match its entry's. Cheap to check, and it is
-- what stops a bug in one module from writing a line into another entity's
-- books.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION klopt.check_line_matches_entry() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  parent record;
BEGIN
  SELECT entity_id, period_id INTO parent
  FROM klopt.journal_entries
  WHERE id = NEW.entry_id;

  IF parent.entity_id <> NEW.entity_id THEN
    RAISE EXCEPTION
      'klopt: line entity % does not match entry entity %.', NEW.entity_id, parent.entity_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF parent.period_id <> NEW.period_id THEN
    RAISE EXCEPTION
      'klopt: line period % does not match entry period %.', NEW.period_id, parent.period_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

--> statement-breakpoint

CREATE CONSTRAINT TRIGGER journal_lines_match_entry
  AFTER INSERT ON klopt.journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION klopt.check_line_matches_entry();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Period control (spec 6.4)
--
-- "Posting into a closed period is impossible, including via the API."
--
-- Only `hard_closed` is enforced here. `soft_closed` means "accountant only",
-- which is a role question the database has no way to answer, so the
-- application owns that one.
--
-- The booking date must also fall inside the period it claims. Otherwise an
-- entry could be filed into an open period while dated inside a closed one.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION klopt.check_period_open() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  target record;
BEGIN
  SELECT status, starts_on, ends_on, sequence, entity_id
    INTO target
  FROM klopt.periods
  WHERE id = NEW.period_id;

  IF target.entity_id <> NEW.entity_id THEN
    RAISE EXCEPTION 'klopt: period % belongs to another entity.', NEW.period_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF target.status = 'hard_closed' THEN
    RAISE EXCEPTION
      'klopt: period % is hard-closed. Reopening is a deliberate, audited action.',
      target.sequence
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.booking_date < target.starts_on OR NEW.booking_date > target.ends_on THEN
    RAISE EXCEPTION
      'klopt: booking date % is outside period % (% .. %).',
      NEW.booking_date, target.sequence, target.starts_on, target.ends_on
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

--> statement-breakpoint

CREATE TRIGGER journal_entries_period_open
  BEFORE INSERT ON klopt.journal_entries
  FOR EACH ROW EXECUTE FUNCTION klopt.check_period_open();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Hash chain linkage (spec 6.2)
--
-- The content hash is computed by @klopt/core, which is where it is testable
-- and where an auditor's reimplementation can be compared against it. What the
-- database enforces is the shape of the chain: dense sequence from 1, and each
-- entry's previous_hash equal to the actual hash of its predecessor.
--
-- That is the half that matters against tampering. Rewriting one entry's
-- content breaks its own hash, which core's verifier catches; splicing an entry
-- out or reordering the chain breaks linkage, which this catches immediately.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION klopt.check_chain_link() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  predecessor_hash char(64);
BEGIN
  IF NEW.chain_sequence < 1 THEN
    RAISE EXCEPTION 'klopt: chain sequence starts at 1, got %.', NEW.chain_sequence
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.chain_sequence = 1 THEN
    IF NEW.previous_hash IS NOT NULL THEN
      RAISE EXCEPTION 'klopt: the first entry of an entity has no previous hash.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT hash INTO predecessor_hash
  FROM klopt.journal_entries
  WHERE entity_id = NEW.entity_id
    AND chain_sequence = NEW.chain_sequence - 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'klopt: chain gap at sequence % for entity %.', NEW.chain_sequence, NEW.entity_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.previous_hash IS DISTINCT FROM predecessor_hash THEN
    RAISE EXCEPTION
      'klopt: chain break at sequence %: previous_hash does not match the preceding entry.',
      NEW.chain_sequence
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

--> statement-breakpoint

CREATE TRIGGER journal_entries_chain_link
  BEFORE INSERT ON klopt.journal_entries
  FOR EACH ROW EXECUTE FUNCTION klopt.check_chain_link();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Gapless number allocation (spec 6.2)
--
-- A Postgres sequence is not gapless: a rollback burns its value, and an
-- invoice number gap is a question from the Belastingdienst. This allocates
-- under a row lock inside the caller's transaction, so a rollback returns the
-- number to the pool.
--
-- The lock serialises postings per (entity, document type, year), which for the
-- chain scope means per entity. That is inherent — a hash chain is a sequence,
-- and a sequence has one writer at a time.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION klopt.allocate_number(
  p_entity_id uuid,
  p_document_type text,
  p_fiscal_year_code text
) RETURNS bigint
  LANGUAGE plpgsql AS $$
DECLARE
  allocated bigint;
BEGIN
  INSERT INTO klopt.number_sequences (entity_id, document_type, fiscal_year_code, next_value)
  VALUES (p_entity_id, p_document_type, p_fiscal_year_code, 1)
  ON CONFLICT (entity_id, document_type, fiscal_year_code) DO NOTHING;

  UPDATE klopt.number_sequences
     SET next_value = next_value + 1
   WHERE entity_id = p_entity_id
     AND document_type = p_document_type
     AND fiscal_year_code = p_fiscal_year_code
  RETURNING next_value - 1 INTO allocated;

  RETURN allocated;
END;
$$;
