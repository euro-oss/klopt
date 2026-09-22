/**
 * What every test in this project needs before a single file is imported.
 *
 * ## An encryption key
 *
 * `encryptSecret` refuses without `KLOPT_ENCRYPTION_KEY`, deliberately: the
 * alternative is storing a password as it was typed, and that is discovered by
 * somebody else, later, in a dump. Six test files were each setting their own
 * copy, `webhooks.test.ts` was not, and its thirteen failures were the domain
 * correctly refusing rather than anything being broken.
 *
 * It is set here rather than in CI, and it is a literal rather than a secret,
 * for two reasons. A repository secret is not available to a pull request from
 * a fork, so every external contribution would fail exactly as this did. And
 * CONTRIBUTING promises that a green `pnpm run verify` locally means a green
 * CI — which stops being true the moment CI has configuration a contributor's
 * machine does not.
 *
 * A setup file rather than a single ambient variable on purpose: suites such as
 * `inbound` and `exact` delete the key mid-run to prove the no-key path, and a
 * worker process is reused across files, so a plain job-level variable could be
 * gone by the time a later file needs it. Re-setting it here before each file
 * makes the suite independent of both the shell that launched it and the order
 * files happen to run in. `??=` leaves an externally provided key in place.
 *
 * Nothing secret is protected by it: it encrypts fixtures that are thrown away
 * at the end of the run. The real key is an operator's concern, documented in
 * `.env.example`.
 */

// Not overwritten if something upstream set one: a run investigating a real
// key's behaviour should get the key it asked for.
process.env['KLOPT_ENCRYPTION_KEY'] ??= 'test-key-not-for-production-0123456789'
