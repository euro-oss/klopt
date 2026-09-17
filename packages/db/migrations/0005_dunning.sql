-- What a delivery was for, and which reminder it was.
--
-- Reminders live in the same table as the invoice itself, because they are the
-- same act and because "which stage has this invoice reached" is then a fact
-- about its delivery history rather than a column to keep in step with it.

ALTER TABLE "klopt"."invoice_deliveries" ADD COLUMN "purpose" text DEFAULT 'invoice' NOT NULL;--> statement-breakpoint
ALTER TABLE "klopt"."invoice_deliveries" ADD COLUMN "dunning_stage" smallint;