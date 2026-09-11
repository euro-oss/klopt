-- The buyer, as they were when the invoice was issued (spec 7.5, 7.6).
--
-- `sales_invoices` held only `contact_id`, so every rendering of an issued
-- invoice read the buyer's name and address out of the contact row *as it
-- stands today*. Two things follow, and neither is acceptable.
--
-- The first is a correctness bug that exists without anybody asking for GDPR:
-- a customer moves, and last year's invoice — the one nobody has downloaded
-- yet — now renders with this year's address. The UBL bytes are written on
-- first request rather than at issue, so "nothing is regenerated, so nothing
-- can drift" only holds once somebody has asked for it. Until then there is
-- nothing to drift *from*. The contact screen promises the opposite in as many
-- words: "Facturen die al verstuurd zijn houden wat erop stond."
--
-- The second is that it makes the contact row load-bearing for the
-- bewaarplicht. An invoice must name its buyer for seven years; if that name
-- lives only in `contacts`, then `contacts` cannot be pseudonymised on an
-- erasure request without falsifying the books. Snapshotting here is what
-- separates "who we bill today" from "who this invoice was for", and that
-- separation is the whole reason a pseudonymisation path can exist at all.
--
-- Nullable, because a draft has no buyer snapshot yet — it is taken at issue,
-- alongside the number and the journal entry, which are the other two things
-- an invoice acquires by becoming real.

alter table klopt.sales_invoices
  add column buyer_name text,
  add column buyer_legal_name text,
  add column buyer_vat_number text,
  add column buyer_kvk_number text,
  add column buyer_country_code char(2),
  add column buyer_street text,
  add column buyer_house_number text,
  add column buyer_postal_code text,
  add column buyer_city text,
  add column buyer_electronic_address text,
  add column buyer_electronic_address_scheme text;

-- Backfill from the contact as it stands. For invoices issued before this
-- column existed that is the best answer available, and it is the same answer
-- they were already getting — this migration does not change what they render,
-- it stops it changing from here on.
update klopt.sales_invoices as i
set
  buyer_name = c.name,
  buyer_legal_name = c.legal_name,
  buyer_vat_number = c.vat_number,
  buyer_kvk_number = c.kvk_number,
  buyer_country_code = c.country_code,
  buyer_street = a.street,
  buyer_house_number = a.house_number,
  buyer_postal_code = a.postal_code,
  buyer_city = a.city,
  buyer_electronic_address = c.electronic_address,
  buyer_electronic_address_scheme = c.electronic_address_scheme
from klopt.contacts as c
  left join klopt.contact_addresses as a
    on a.contact_id = c.id and a.kind = 'street'
where c.id = i.contact_id
  and i.status <> 'draft';

-- An invoice that has been issued names its buyer. Drafts are exempt: they have
-- no number and no entry either, and this is the same kind of fact.
alter table klopt.sales_invoices
  add constraint sales_invoices_issued_names_buyer
  check (status = 'draft' or buyer_name is not null);
