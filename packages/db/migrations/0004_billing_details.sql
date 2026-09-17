-- The seller's and buyer's details as a UBL invoice needs them (spec 7.5).
--
-- All nullable: an administration is a useful shadow ledger long before anybody
-- invoices out of it. The UBL generator refuses when they are missing, naming
-- the BT number of each one, which is the moment they start to matter.

ALTER TABLE "klopt"."entities" ADD COLUMN "street" text;--> statement-breakpoint
ALTER TABLE "klopt"."entities" ADD COLUMN "house_number" text;--> statement-breakpoint
ALTER TABLE "klopt"."entities" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "klopt"."entities" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "klopt"."entities" ADD COLUMN "country_code" char(2) DEFAULT 'NL' NOT NULL;--> statement-breakpoint
ALTER TABLE "klopt"."entities" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "klopt"."entities" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "klopt"."entities" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "klopt"."entities" ADD COLUMN "iban" text;--> statement-breakpoint
ALTER TABLE "klopt"."entities" ADD COLUMN "bic" text;--> statement-breakpoint
ALTER TABLE "klopt"."entities" ADD COLUMN "electronic_address" text;--> statement-breakpoint
ALTER TABLE "klopt"."entities" ADD COLUMN "electronic_address_scheme" text;--> statement-breakpoint
ALTER TABLE "klopt"."contacts" ADD COLUMN "electronic_address" text;--> statement-breakpoint
ALTER TABLE "klopt"."contacts" ADD COLUMN "electronic_address_scheme" text;