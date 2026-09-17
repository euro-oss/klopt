-- OAuth 2.1 authorization server, so a hosted instance can be connected to an
-- agent without anybody pasting a token (spec 10.3, MCP authorization).
--
-- Two tables and no more. An access token is not one of them: OAuth here is a
-- way to *obtain* an ordinary `api_tokens` row, so everything downstream —
-- permissions, entity scoping, the audit trail, revocation — is the machinery
-- that already exists rather than a second one that has to agree with it.

create table klopt.oauth_clients (
  id uuid primary key,
  -- The public identifier. Not a secret: MCP clients are public clients and
  -- authenticate with PKCE, so there is nothing here worth stealing.
  client_id text not null unique,
  client_name text not null,
  -- Exact-match list. A prefix match here is an open redirect, which is how
  -- an authorization code ends up at somebody else's server.
  redirect_uris text[] not null,
  -- Who registered it, when the registration was not anonymous. Dynamic
  -- registration (RFC 7591) is open by necessity — a client cannot ask a human
  -- to pre-register it — so this is null more often than not.
  registered_by text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  constraint oauth_clients_has_redirect check (cardinality(redirect_uris) > 0)
);

create table klopt.oauth_authorization_codes (
  id uuid primary key,
  -- Hashed, like every other credential in this schema. A code is short-lived
  -- but a database dump outlives it.
  code_hash char(64) not null unique,
  client_id text not null references klopt.oauth_clients (client_id) on delete cascade,
  -- Repeated from the request and checked again at the token endpoint: the
  -- redirect a code was issued for is the only one it may be redeemed against.
  redirect_uri text not null,
  -- PKCE. S256 only — `plain` offers no protection against an intercepted
  -- code, which is the entire threat this defends against.
  code_challenge text not null,
  -- RFC 8707. The audience the resulting token is for, so a token minted for
  -- one instance cannot be replayed against another (the confused deputy the
  -- MCP authorization spec calls out).
  resource text,
  scope text[] not null,
  user_id text not null,
  entity_id uuid not null references klopt.entities (id),
  expires_at timestamptz not null,
  -- Single use. Set on redemption rather than deleted, so a second attempt is
  -- distinguishable from a code that never existed and can be treated as the
  -- attack it probably is.
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index oauth_authorization_codes_expiry on klopt.oauth_authorization_codes (expires_at);

-- The token an OAuth exchange produces is an ordinary API token. This records
-- which client obtained it, so a person looking at Toegang can tell "Claude"
-- from "a script somebody wrote", and so revoking a client can revoke its
-- tokens.
alter table klopt.api_tokens add column oauth_client_id text references klopt.oauth_clients (client_id);
