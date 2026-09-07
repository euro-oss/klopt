-- The evidence chain for a filing (spec 7.2).
--
-- "Store every submission: instance sent, timestamp, Digipoort message id, all
-- status responses, and the resulting confirmation."
--
-- Note "all status responses", plural. A Digipoort filing is delivered once and
-- then polled until the Belastingdienst has processed it, so a submission has a
-- history rather than a state -- and the history is the evidence. One row per
-- interaction, append-only, in order.
--
-- The instance is stored on the row that sent it rather than once per filing,
-- because a suppletie sends a different instance and a retry after a rejection
-- sends a corrected one. Which bytes went out when is exactly the question this
-- table exists to answer.

CREATE TYPE "klopt"."filing_transport" AS ENUM('manual', 'sbr_provider', 'digipoort');--> statement-breakpoint
CREATE TYPE "klopt"."filing_status" AS ENUM('prepared', 'delivered', 'accepted', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "klopt"."filing_interaction" AS ENUM('deliver', 'status', 'confirmation');--> statement-breakpoint

CREATE TABLE "klopt"."filing_submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"filing_id" uuid NOT NULL,
	-- `deliver` handed it over, `status` polled, `confirmation` is what the
	-- operator typed in from Mijn Belastingdienst on the manual path.
	"interaction" "klopt"."filing_interaction" NOT NULL,
	"transport" "klopt"."filing_transport" NOT NULL,
	"status" "klopt"."filing_status" NOT NULL,
	-- Digipoort's kenmerk, a provider's job id, or the operator's receipt number.
	"reference" text,
	"taxonomy_version" text,
	-- The bytes that were filed. Null on a poll, which sends no instance.
	"instance_xml" text,
	-- The human-readable rendering that went with it, kept for the same reason.
	"summary" text,
	-- Verbatim, unparsed. When a service changes its wording the evidence stays.
	"request_body" text,
	"response_body" text,
	"error" text,
	"instructions" text,
	"actor_id" text,
	"at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "klopt"."filing_submissions" ADD CONSTRAINT "filing_submissions_entity_id_entities_id_fk"
	FOREIGN KEY ("entity_id") REFERENCES "klopt"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klopt"."filing_submissions" ADD CONSTRAINT "filing_submissions_filing_id_vat_filings_id_fk"
	FOREIGN KEY ("filing_id") REFERENCES "klopt"."vat_filings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "filing_submissions_filing" ON "klopt"."filing_submissions" ("filing_id","at");--> statement-breakpoint

-- Evidence that can be edited is not evidence.
CREATE TRIGGER filing_submissions_append_only
	BEFORE UPDATE OR DELETE ON "klopt"."filing_submissions"
	FOR EACH ROW EXECUTE FUNCTION klopt.reject_mutation();--> statement-breakpoint

-- The current state of a filing's delivery, denormalised onto the filing so a
-- list of periods does not need the history. The history remains the truth.
ALTER TABLE "klopt"."vat_filings" ADD COLUMN "delivery_status" "klopt"."filing_status";--> statement-breakpoint
ALTER TABLE "klopt"."vat_filings" ADD COLUMN "taxonomy_version" text;
