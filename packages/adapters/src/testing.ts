/**
 * Test doubles for the adapters that need a third party.
 *
 * In `src/` rather than in a test folder, for the same reason `@klopt/db/testing`
 * is: two suites need the same double — `packages/adapters/test` and
 * `apps/web/test` — and a copy in each is two things to keep in step with one
 * protocol.
 *
 * Kept out of the package's main entry point on purpose. A double that is one
 * import away from production code is a double that will eventually be in it.
 */

export {
  startFakeS3,
  type FakeS3,
  type FakeS3BucketOptions,
  type FakeS3Options,
  type FakeS3Version,
} from './documents/fake-s3.js'
