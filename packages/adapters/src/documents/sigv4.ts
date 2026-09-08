import { createHash, createHmac } from 'node:crypto'

/**
 * AWS Signature Version 4, for S3 requests.
 *
 * ## Why this is written out rather than pulled in
 *
 * `@aws-sdk/client-s3` would do this, and a great deal else, at the cost of a
 * large transitive tree in the code path that holds statutory records. For a
 * self-hostable tool whose pitch includes being auditable, that tree is a real
 * cost.
 *
 * The reason it is *safe* to write out here is the same reason the Digipoort
 * WS-Security signer was deliberately **not** written out (ADR 0024): whether a
 * signature is correct is either verifiable locally or it is not. Digipoort
 * needs a PKIoverheid certificate and a run against Logius's pre-production
 * environment, so an unverified signer there would have been a guess dressed as
 * an implementation. S3 needs MinIO, which is in `compose.yaml` with an
 * object-lock bucket and is what the tests run against. A wrong signature here
 * fails loudly and immediately.
 *
 * The scope is six operations — put, get, head, delete, and setting and reading
 * object retention — and the keys are always lowercase hex sha256, which
 * removes the whole class of URI-encoding bugs that makes signing S3 requests
 * unpleasant.
 *
 * ## What the algorithm actually requires
 *
 * Four steps, and the third is the one everybody gets wrong:
 *
 *   1. A **canonical request**: method, path, sorted query, sorted signed
 *      headers, and the sha256 of the payload. S3 requires the payload hash in
 *      `x-amz-content-sha256` as well, unsigned-payload streaming aside.
 *   2. A **string to sign** naming the algorithm, the timestamp and the scope.
 *   3. A **signing key derived by four chained HMACs** — date, region, service,
 *      `aws4_request` — each keyed by the previous result. Not one HMAC with a
 *      concatenated string, which is the mistake that produces a plausible
 *      signature the server rejects with no explanation.
 *   4. The signature, as an `Authorization` header naming the signed headers in
 *      the same order they were canonicalised.
 */

export interface S3Credentials {
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly region: string
}

export interface SignedRequest {
  readonly method: 'GET' | 'PUT' | 'HEAD' | 'DELETE' | 'POST'
  /** Already URI-encoded, beginning with a slash. */
  readonly path: string
  readonly query?: Readonly<Record<string, string>> | undefined
  readonly headers: Readonly<Record<string, string>>
  readonly body?: Uint8Array | undefined
}

const sha256 = (payload: Uint8Array | string): string =>
  createHash('sha256')
    .update(typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.from(payload))
    .digest('hex')

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac('sha256', key).update(data, 'utf8').digest()

/** `20260908T091500Z` and `20260908`, which the algorithm wants separately. */
function timestamps(now: Date): { readonly amzDate: string; readonly dateStamp: string } {
  const amzDate = `${now.toISOString().replace(/[:-]|\.\d{3}/g, '')}`
  return { amzDate, dateStamp: amzDate.slice(0, 8) }
}

/**
 * The signing key: four chained HMACs, each keyed by the last.
 *
 * Written out one line per step rather than folded, because a fold here reads
 * identically to the wrong version and this is the part that silently fails.
 */
function signingKey(credentials: S3Credentials, dateStamp: string, service: string): Buffer {
  const date = hmac(`AWS4${credentials.secretAccessKey}`, dateStamp)
  const region = hmac(date, credentials.region)
  const scoped = hmac(region, service)
  return hmac(scoped, 'aws4_request')
}

function canonicalQuery(query: Readonly<Record<string, string>> | undefined): string {
  if (query === undefined) return ''

  // Sorted by key, and both halves encoded. S3 signs the query it receives, so
  // a differently-ordered one is a different request.
  return Object.keys(query)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key] ?? '')}`)
    .join('&')
}

/**
 * Sign a request, returning the headers to send.
 *
 * `host` and `x-amz-content-sha256` are added here rather than by the caller
 * because both are signed and both are easy to omit — and omitting a signed
 * header produces a signature mismatch with no hint as to which one.
 */
export function signS3Request(
  request: SignedRequest,
  credentials: S3Credentials,
  endpoint: URL,
  now: Date = new Date(),
): Record<string, string> {
  const { amzDate, dateStamp } = timestamps(now)
  const payloadHash = sha256(request.body ?? new Uint8Array())

  const headers: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), value]),
    ),
    host: endpoint.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  }

  const signedHeaderNames = Object.keys(headers).sort()
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${headers[name]?.trim() ?? ''}\n`)
    .join('')
  const signedHeaders = signedHeaderNames.join(';')

  const canonicalRequest = [
    request.method,
    request.path,
    canonicalQuery(request.query),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const scope = `${dateStamp}/${credentials.region}/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')

  const signature = hmac(signingKey(credentials, dateStamp, 's3'), stringToSign).toString('hex')

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}
