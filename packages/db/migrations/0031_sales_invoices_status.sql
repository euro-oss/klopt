-- Open sales invoices are filtered by status = 'issued' (and then unpaid in
-- process). Purchase invoices already have (entity_id, status); sales did not
-- (audit M8).

CREATE INDEX IF NOT EXISTS sales_invoices_status
  ON klopt.sales_invoices (entity_id, status);
