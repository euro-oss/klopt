-- `ubl_category` was `char(2)`, and a UBL/Peppol category code is one or two
-- characters: S, Z, E, K, G, O, and AE. Postgres blank-pads `character(n)` on
-- storage, so every one-letter code came back over the wire as `'S '` -- and
-- `<cbc:ID>S </cbc:ID>` is not a code in UNCL5305, which is what BR-CL-18
-- checks. Every UBL invoice generated from the database since M1 carried it.
--
-- Nothing caught it because the UBL golden tests build their fixture by hand
-- rather than reading it back from a column. `length()` and `::text` both strip
-- the padding, so psql shows `S` and only the driver sees the truth.
--
-- Fixed by the column type rather than by trimming on read: a fixed-width type
-- for a variable-width code is the bug, and a trim in one of six query sites is
-- five sites away from a fix.

ALTER TABLE "klopt"."tax_codes"
	ALTER COLUMN "ubl_category" TYPE text USING rtrim("ubl_category");--> statement-breakpoint
ALTER TABLE "klopt"."tax_codes"
	ALTER COLUMN "ubl_category" SET DEFAULT 'S';--> statement-breakpoint
ALTER TABLE "klopt"."tax_codes" ADD CONSTRAINT "tax_codes_ubl_category_shape"
	CHECK ("ubl_category" ~ '^[A-Z]{1,2}$');
