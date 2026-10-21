-- Missing standard Dutch VAT codes on the shipped nl-mkb chart.
--
-- New administrations get these from reference-data/charts/nl-mkb.json at
-- setup. Existing entities that already run that chart need the same rows so
-- Moneybird rates (0% purchase, 9% verlegd / ICV / INV, historical 6% / 19%
-- sales and purchases) can map. INSERT only, idempotent: skip when the code
-- name already exists for the entity, and ON CONFLICT on
-- (entity_id, code, valid_from).
--
-- nl-mkb detection: entities do not store a chart id. An entity is treated as
-- nl-mkb when it already has H21, VH21 and VERL-ONTV (the shipped chart's
-- signature codes).
--
-- Paired reverse-charge / acquisition / import codes (…-ONTV with …-VOOR,
-- ICV9/ICV9-VOOR, INV9/INV9-VOOR) are inserted only when *neither* half exists
-- for the entity. Inserting one half alone would leave an unpaired deduction
-- code, or point deductionCode at a row that already means something else.
--
-- valid_from copies H21's window on that entity (fallback 2025-01-01) so the
-- new codes are in force for the same period as the rest of the chart. L6,
-- H19, VL6 and VH19 stay open-ended (no valid_to): they are for corrections,
-- late invoices at an old rate, and imports — not date-limited 1c/5b history.

-- Singles: L6, H19, VL6, VH19, VGEEN.
INSERT INTO "klopt"."tax_codes" (
	"id",
	"entity_id",
	"code",
	"description",
	"rate_basis_points",
	"direction",
	"account_id",
	"is_reverse_charge",
	"ubl_category",
	"base_rubriek",
	"vat_rubriek",
	"scope",
	"reverse_charge",
	"deductibility",
	"pro_rata_basis_points",
	"supply_kind",
	"deduction_code",
	"valid_from",
	"valid_to"
)
SELECT
	gen_random_uuid(),
	e."id",
	n."code",
	n."description",
	n."rate_basis_points",
	n."direction"::"klopt"."tax_direction",
	tpl."account_id",
	n."is_reverse_charge",
	n."ubl_category",
	n."base_rubriek",
	n."vat_rubriek",
	n."scope"::"klopt"."tax_scope",
	n."reverse_charge"::"klopt"."reverse_charge",
	n."deductibility"::"klopt"."deductibility",
	NULL,
	n."supply_kind"::"klopt"."supply_kind",
	n."deduction_code",
	COALESCE(anchor."valid_from", DATE '2025-01-01'),
	NULL
FROM "klopt"."entities" e
INNER JOIN (
	VALUES
		('L6', 'BTW overig 6%', 600, 'output', 'H21', false, 'S', '1c', '1c', 'domestic', 'none', 'full', 'not_applicable', NULL),
		('H19', 'BTW overig 19%', 1900, 'output', 'H21', false, 'S', '1c', '1c', 'domestic', 'none', 'full', 'not_applicable', NULL),
		('VL6', 'Voorbelasting overig 6%', 600, 'input', 'VH21', false, 'S', NULL, '5b', 'domestic', 'none', 'full', 'not_applicable', NULL),
		('VH19', 'Voorbelasting overig 19%', 1900, 'input', 'VH21', false, 'S', NULL, '5b', 'domestic', 'none', 'full', 'not_applicable', NULL),
		('VGEEN', 'Inkoop zonder btw', 0, 'input', 'VH21', false, 'O', NULL, NULL, 'out_of_scope', 'none', 'none', 'not_applicable', NULL)
) AS n (
	"code",
	"description",
	"rate_basis_points",
	"direction",
	"template_code",
	"is_reverse_charge",
	"ubl_category",
	"base_rubriek",
	"vat_rubriek",
	"scope",
	"reverse_charge",
	"deductibility",
	"supply_kind",
	"deduction_code"
) ON TRUE
INNER JOIN "klopt"."tax_codes" tpl
	ON tpl."entity_id" = e."id"
	AND tpl."code" = n."template_code"
INNER JOIN LATERAL (
	SELECT t."valid_from"
	FROM "klopt"."tax_codes" t
	WHERE t."entity_id" = e."id" AND t."code" = 'H21'
	ORDER BY t."valid_from" ASC
	LIMIT 1
) anchor ON TRUE
WHERE EXISTS (
	SELECT 1 FROM "klopt"."tax_codes" t
	WHERE t."entity_id" = e."id" AND t."code" = 'H21'
)
AND EXISTS (
	SELECT 1 FROM "klopt"."tax_codes" t
	WHERE t."entity_id" = e."id" AND t."code" = 'VH21'
)
AND EXISTS (
	SELECT 1 FROM "klopt"."tax_codes" t
	WHERE t."entity_id" = e."id" AND t."code" = 'VERL-ONTV'
)
AND NOT EXISTS (
	SELECT 1 FROM "klopt"."tax_codes" existing
	WHERE existing."entity_id" = e."id" AND existing."code" = n."code"
)
ON CONFLICT ("entity_id", "code", "valid_from") DO NOTHING;
--> statement-breakpoint

-- Pairs: insert both halves only when neither code name exists yet.
INSERT INTO "klopt"."tax_codes" (
	"id",
	"entity_id",
	"code",
	"description",
	"rate_basis_points",
	"direction",
	"account_id",
	"is_reverse_charge",
	"ubl_category",
	"base_rubriek",
	"vat_rubriek",
	"scope",
	"reverse_charge",
	"deductibility",
	"pro_rata_basis_points",
	"supply_kind",
	"deduction_code",
	"valid_from",
	"valid_to"
)
SELECT
	gen_random_uuid(),
	e."id",
	n."code",
	n."description",
	n."rate_basis_points",
	n."direction"::"klopt"."tax_direction",
	tpl."account_id",
	n."is_reverse_charge",
	n."ubl_category",
	n."base_rubriek",
	n."vat_rubriek",
	n."scope"::"klopt"."tax_scope",
	n."reverse_charge"::"klopt"."reverse_charge",
	n."deductibility"::"klopt"."deductibility",
	NULL,
	n."supply_kind"::"klopt"."supply_kind",
	n."deduction_code",
	COALESCE(anchor."valid_from", DATE '2025-01-01'),
	NULL
FROM "klopt"."entities" e
INNER JOIN (
	VALUES
		('VERL9-ONTV', 'BTW verlegd naar u 9%, verschuldigd', 900, 'input', 'VERL-ONTV', true, 'AE', '2a', '2a', 'domestic', 'domestic', 'full', 'not_applicable', 'VERL9-VOOR', 'VERL9-ONTV', 'VERL9-VOOR'),
		('VERL9-VOOR', 'BTW verlegd naar u 9%, voorbelasting', 900, 'input', 'VERL-VOOR', false, 'AE', NULL, '5b', 'domestic', 'none', 'full', 'not_applicable', NULL, 'VERL9-ONTV', 'VERL9-VOOR'),
		('ICV9', 'Intracommunautaire verwerving 9%, verschuldigd', 900, 'input', 'ICV21', false, 'K', '4b', '4b', 'intra_community_acquisition', 'none', 'full', 'goods', 'ICV9-VOOR', 'ICV9', 'ICV9-VOOR'),
		('ICV9-VOOR', 'Intracommunautaire verwerving 9%, voorbelasting', 900, 'input', 'ICV21-VOOR', false, 'K', NULL, '5b', 'intra_community_acquisition', 'none', 'full', 'not_applicable', NULL, 'ICV9', 'ICV9-VOOR'),
		('INV9', 'Invoer met artikel 23-verlegging 9%, verschuldigd', 900, 'input', 'INV23', true, 'S', '4a', '4a', 'import', 'import_article_23', 'full', 'goods', 'INV9-VOOR', 'INV9', 'INV9-VOOR'),
		('INV9-VOOR', 'Invoer met artikel 23-verlegging 9%, voorbelasting', 900, 'input', 'INV23-VOOR', false, 'S', NULL, '5b', 'import', 'none', 'full', 'not_applicable', NULL, 'INV9', 'INV9-VOOR')
) AS n (
	"code",
	"description",
	"rate_basis_points",
	"direction",
	"template_code",
	"is_reverse_charge",
	"ubl_category",
	"base_rubriek",
	"vat_rubriek",
	"scope",
	"reverse_charge",
	"deductibility",
	"supply_kind",
	"deduction_code",
	"pair_main",
	"pair_half"
) ON TRUE
INNER JOIN "klopt"."tax_codes" tpl
	ON tpl."entity_id" = e."id"
	AND tpl."code" = n."template_code"
INNER JOIN LATERAL (
	SELECT t."valid_from"
	FROM "klopt"."tax_codes" t
	WHERE t."entity_id" = e."id" AND t."code" = 'H21'
	ORDER BY t."valid_from" ASC
	LIMIT 1
) anchor ON TRUE
WHERE EXISTS (
	SELECT 1 FROM "klopt"."tax_codes" t
	WHERE t."entity_id" = e."id" AND t."code" = 'H21'
)
AND EXISTS (
	SELECT 1 FROM "klopt"."tax_codes" t
	WHERE t."entity_id" = e."id" AND t."code" = 'VH21'
)
AND EXISTS (
	SELECT 1 FROM "klopt"."tax_codes" t
	WHERE t."entity_id" = e."id" AND t."code" = 'VERL-ONTV'
)
AND NOT EXISTS (
	SELECT 1 FROM "klopt"."tax_codes" existing
	WHERE existing."entity_id" = e."id" AND existing."code" = n."pair_main"
)
AND NOT EXISTS (
	SELECT 1 FROM "klopt"."tax_codes" existing
	WHERE existing."entity_id" = e."id" AND existing."code" = n."pair_half"
)
ON CONFLICT ("entity_id", "code", "valid_from") DO NOTHING;
