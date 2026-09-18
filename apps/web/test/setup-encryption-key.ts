/**
 * A test encryption key, set before every web test file.
 *
 * Several API-contract suites drive operations that store an encrypted secret —
 * a webhook signing secret, an Exact client secret — and so they need a key,
 * exactly as the running application does (see `packages/db/src/secrets.ts`).
 * Without one, `response-shapes` and `webhooks` fail with "There is no
 * KLOPT_ENCRYPTION_KEY", which is a misconfiguration of the run rather than a
 * defect in the code.
 *
 * A setup file rather than a single ambient variable on purpose: two suites
 * (`inbound`, `exact`) delete the key mid-run to prove the no-key path, and a
 * worker process is reused across files, so a plain job-level variable could be
 * gone by the time a later file needs it. Re-setting it here before each file
 * makes the suite independent of both the shell that launched it and the order
 * files happen to run in. `??=` leaves an externally provided key in place.
 *
 * Not a production key.
 */
process.env['KLOPT_ENCRYPTION_KEY'] ??= 'test-key-not-for-production-0123456789'
