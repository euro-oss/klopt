import postgres from 'postgres'

const INSTALL_SQL = `
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION klopt.test_block_release_match_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action = 'bank.releaseMatch'
     AND current_setting('klopt.test_block_release_match_audit', true) = 'on' THEN
    RAISE EXCEPTION 'test_block_release_match_audit';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS test_block_release_match_audit ON klopt.audit_log;
CREATE TRIGGER test_block_release_match_audit
BEFORE INSERT ON klopt.audit_log
FOR EACH ROW EXECUTE FUNCTION klopt.test_block_release_match_audit();
`

const TEARDOWN_SQL = `
SET lock_timeout = '5s';
DROP TRIGGER IF EXISTS test_block_release_match_audit ON klopt.audit_log;
DROP FUNCTION IF EXISTS klopt.test_block_release_match_audit();
`

export async function installAuditReleaseMatchBlockTrigger(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, onnotice: () => undefined })
  try {
    await sql.unsafe(INSTALL_SQL)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

export async function teardownAuditReleaseMatchBlockTrigger(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, onnotice: () => undefined })
  try {
    await sql.unsafe(TEARDOWN_SQL)
  } finally {
    await sql.end({ timeout: 5 })
  }
}
