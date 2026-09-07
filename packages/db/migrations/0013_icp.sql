-- The ICP opgaaf's evidence (spec 7.2).
--
-- "Validate counterparty VAT numbers against VIES, cache results with a
-- timestamp, and store the validation proof. Store what VIES said and when,
-- because that is your evidence for applying the zero rate."
--
-- Append-only by intent: every check is a row, and the newest one for a number
-- is the current answer. Overwriting would destroy the point -- a number that
-- was valid last quarter and is invalid now is two facts, and the first one is
-- what defends last quarter's zero rate.
--
-- `raw` is the response verbatim. When VIES renames a field, the evidence
-- survives our parser.

CREATE TYPE "klopt"."vat_number_outcome" AS ENUM('valid', 'invalid', 'unavailable');--> statement-breakpoint

CREATE TABLE "klopt"."vat_number_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	-- Normalised: uppercase, no spaces or punctuation. What VIES was asked.
	"vat_number" text NOT NULL,
	"country_code" char(2) NOT NULL,
	"outcome" "klopt"."vat_number_outcome" NOT NULL,
	"name" text,
	"address" text,
	-- VIES's own request date, which is not necessarily ours.
	"request_date" text,
	-- The consultation number. This is the proof; null when asked anonymously.
	"request_identifier" text,
	"checked_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"raw" text NOT NULL,
	"error" text,
	"requested_by" text,
	-- One key per request, shared by every number in that request's batch. A
	-- retry replays the stored answers instead of asking VIES again -- which is
	-- both the idempotency the operation registry insists on for a write and
	-- basic manners towards a public register.
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "klopt"."vat_number_checks" ADD CONSTRAINT "vat_number_checks_entity_id_entities_id_fk"
	FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- The lookup is always "the newest check for this number", so the index is
-- ordered to answer it without a sort.
CREATE INDEX "vat_number_checks_lookup" ON "klopt"."vat_number_checks"
	("entity_id","vat_number","checked_at" DESC);--> statement-breakpoint
CREATE INDEX "vat_number_checks_idempotency" ON "klopt"."vat_number_checks"
	("entity_id","idempotency_key");--> statement-breakpoint

-- A history is only append-only if nothing updates it.
CREATE TRIGGER vat_number_checks_append_only
	BEFORE UPDATE OR DELETE ON "klopt"."vat_number_checks"
	FOR EACH ROW EXECUTE FUNCTION klopt.reject_mutation();
