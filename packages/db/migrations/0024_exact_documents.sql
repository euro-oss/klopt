-- Bringing the document archive across from Exact Online (spec 13).
--
-- Separate from the rest of the import because it is a different kind of work.
-- The chart, the relations and the open items are a few thousand rows read in
-- nine requests and written in one transaction. The archive is ten years of
-- scanned invoices — tens of thousands of files, several gigabytes, and a
-- daily rate limit — which is a job that runs for hours, survives restarts and
-- resumes where it stopped.

create table klopt.exact_document_runs (
  id uuid primary key,
  entity_id uuid not null references klopt.entities (id),
  division_code integer not null,
  -- 'pending' until the worker picks it up, 'running' between batches,
  -- 'done' when Exact has no more pages, 'failed' when something the run
  -- cannot get past happened. 'paused' is the rate limit: not an error, and it
  -- resumes on its own.
  state text not null default 'pending',
  -- Where the walk got to: Exact's own `__next`, which is absolute and opaque.
  -- Null before the first page and after the last.
  cursor text,
  -- Progress, so a screen can say something more useful than "working".
  documents_seen integer not null default 0,
  attachments_stored integer not null default 0,
  attachments_skipped integer not null default 0,
  bytes_stored bigint not null default 0,
  requested_by text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  constraint exact_document_runs_state check (
    state in ('pending', 'running', 'paused', 'done', 'failed')
  )
);

-- One run per administration. Asking again while one is going should join it,
-- not start a second walk over the same archive.
create unique index exact_document_runs_entity on klopt.exact_document_runs (entity_id);

-- One row per Exact attachment already stored here.
--
-- The skip list, and the provenance. Without it a resumed run re-downloads
-- everything it already has to discover, by hash, that it already has it —
-- which is the whole archive over the wire twice.
create table klopt.exact_attachments (
  id uuid primary key,
  entity_id uuid not null references klopt.entities (id),
  -- Exact's own GUIDs, kept so the same archive imported twice is one archive.
  exact_attachment_id text not null,
  exact_document_id text not null,
  document_id uuid not null references klopt.documents (id),
  subject text,
  document_date date,
  created_at timestamptz not null default now()
);

create unique index exact_attachments_unique
  on klopt.exact_attachments (entity_id, exact_attachment_id);
create index exact_attachments_document on klopt.exact_attachments (entity_id, document_id);
