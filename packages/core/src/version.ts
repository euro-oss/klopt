/**
 * The product's version, in one place.
 *
 * It is not decoration. This string is written into an XAF auditfile's
 * `softwareVersion`, into the XBRL instance filed with the Belastingdienst,
 * into `/api/v1/health`, into the OpenAPI document and into the MCP server's
 * handshake — so "which version produced this file" is a question somebody
 * asks about a document that is seven years old, and the answer has to be
 * true.
 *
 * It was six literals before, all reading `'0.0.0'`, and six copies of a
 * number nobody updates together is a number that is wrong somewhere. The test
 * in `test/version.test.ts` reads the root `package.json` and fails when this
 * and it disagree, which is the only thing that keeps them honest.
 *
 * `KLOPT_VERSION` in the environment still wins where it is read, so a build
 * can stamp a release tag or a commit over it.
 */
export const KLOPT_VERSION = '0.1.0'
