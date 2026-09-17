import {
  DerError,
  TAG,
  encodeBoolean,
  encodeInteger,
  encodeNull,
  encodeObjectIdentifier,
  encodeOctetString,
  encodeSequence,
  encodeSmallInteger,
  expect,
  fromHex,
  readChildren,
  readGeneralizedTime,
  readInteger,
  readNode,
  readObjectIdentifier,
  toHex,
  type DerNode,
} from './der.js'

/**
 * A trusted timestamp over a seal (RFC 3161).
 *
 * ## Why a seal wants a witness
 *
 * `manifest.ts` says a seal can be written down, emailed or read out over the
 * phone, and that is true — but a seal only this instance has ever held proves
 * that *we* say nothing changed. An inspector asking "when did you seal this"
 * has our own word for the date, and the whole artefact exists for the case
 * where our word is the thing in question.
 *
 * A timestamp authority signs "I saw this hash at this time". It learns the
 * hash and nothing else: the seal is 32 bytes over a manifest that is itself a
 * few kilobytes, so nothing about the administration leaves the building.
 *
 * ## What this verifies, and what it deliberately does not
 *
 * It checks that the response was granted, that the imprint in the token is
 * the seal we asked about, and that the nonce is the one we sent — the three
 * things that catch a misrouted, substituted or replayed answer.
 *
 * It does **not** verify the TSA's signature. That needs the authority's
 * certificate chain and a decision about whether to trust it, and neither of
 * those is ours to make: the party checking the evidence is the party who has
 * to trust the TSA. The token is stored verbatim so they can, with
 * `openssl ts -verify` and their own trust anchors. Claiming a verification we
 * cannot ground would be worse than not claiming one.
 */

const OID = {
  sha256: '2.16.840.1.101.3.4.2.1',
  signedData: '1.2.840.113549.1.7.2',
  tstInfo: '1.2.840.113549.1.9.16.1.4',
} as const

export const TIMESTAMP_QUERY_MEDIA_TYPE = 'application/timestamp-query'
export const TIMESTAMP_REPLY_MEDIA_TYPE = 'application/timestamp-reply'

export interface TimeStampRequest {
  /** Lowercase hex, 64 characters. What the authority attests to having seen. */
  readonly sha256: string
  /** Eight random bytes, hex. Ties the answer to this question. */
  readonly nonce: string
  /**
   * Ask the authority to include its certificate.
   *
   * On by default: a token nobody can check without separately obtaining the
   * signer's certificate is evidence that needs a phone call, seven years
   * later, to an authority that may not exist.
   */
  readonly certReq?: boolean
  /** A policy the authority publishes, when one is required. */
  readonly policyOid?: string | null
}

export function encodeTimeStampRequest(request: TimeStampRequest): Uint8Array {
  const imprint = encodeSequence(
    encodeSequence(encodeObjectIdentifier(OID.sha256), encodeNull()),
    encodeOctetString(fromHex(request.sha256)),
  )

  const parts: Uint8Array[] = [encodeSmallInteger(1), imprint]
  if (request.policyOid != null) parts.push(encodeObjectIdentifier(request.policyOid))
  parts.push(encodeInteger(fromHex(request.nonce)))
  if (request.certReq ?? true) parts.push(encodeBoolean(true))

  return encodeSequence(...parts)
}

/** RFC 3161 §2.4.2. 0 and 1 are the two that mean it worked. */
export type TimeStampStatus =
  | 'granted'
  | 'grantedWithMods'
  | 'rejection'
  | 'waiting'
  | 'revocationWarning'
  | 'revocationNotification'

const STATUSES: readonly TimeStampStatus[] = [
  'granted',
  'grantedWithMods',
  'rejection',
  'waiting',
  'revocationWarning',
  'revocationNotification',
]

export interface TimeStampToken {
  /**
   * The authority's whole reply, base64.
   *
   * The reply rather than the token inside it, because that is the file
   * `openssl ts -verify -in reply.tsr` takes — and the point of keeping it is
   * that somebody else can check it without our help.
   */
  readonly token: string
  /** RFC 3339, from the token's own `genTime`. Not our clock. */
  readonly genTime: string
  readonly serialNumber: string
  readonly policyOid: string
  /** The hash the authority says it saw. Checked against the seal. */
  readonly imprintSha256: string
}

export interface TimeStampResponse {
  readonly status: TimeStampStatus
  readonly statusText: string | null
  readonly token: TimeStampToken | null
}

function findContextTagged(children: readonly DerNode[], number: number): DerNode | undefined {
  // Constructed, context-specific: 0xa0 for [0], 0xa1 for [1], and so on.
  return children.find((child) => child.tag === (0xa0 | number))
}

/**
 * Read a reply, and check it is an answer to the question we asked.
 *
 * The three checks are the ones that fail in practice: a rejection reported as
 * a success, an authority answering about a different hash because a proxy
 * cached somebody else's reply, and a replayed token whose nonce belongs to a
 * request from last month.
 */
export function readTimeStampResponse(
  bytes: Uint8Array,
  /**
   * What was asked. The nonce is optional because it is only meaningful at the
   * moment of asking: re-reading a stored reply years later has nothing to
   * compare it against, and checking it against itself would be theatre.
   */
  asked: { readonly sha256: string; readonly nonce?: string },
): TimeStampResponse {
  const response = expect(readNode(bytes), TAG.sequence, 'a TimeStampResp')
  const top = readChildren(response.contents)

  const info = expect(top[0], TAG.sequence, 'the PKIStatusInfo')
  const infoParts = readChildren(info.contents)
  const code = Number(readInteger(expect(infoParts[0], TAG.integer, 'the status')))
  const status = STATUSES[code]
  if (status === undefined) throw new DerError(`Unknown PKIStatus ${String(code)}.`)

  // PKIFreeText: a SEQUENCE OF UTF8String. The first line is the useful one.
  const freeText = infoParts[1]?.tag === TAG.sequence ? readChildren(infoParts[1].contents) : []
  const statusText =
    freeText[0] === undefined ? null : new TextDecoder().decode(freeText[0].contents)

  if (status !== 'granted' && status !== 'grantedWithMods') {
    return { status, statusText, token: null }
  }

  const contentInfo = expect(top[1], TAG.sequence, 'the timeStampToken')
  const contentParts = readChildren(contentInfo.contents)
  const contentType = readObjectIdentifier(
    expect(contentParts[0], TAG.objectIdentifier, 'the content type'),
  )
  if (contentType !== OID.signedData) {
    throw new DerError(`A timeStampToken has to be CMS SignedData, not ${contentType}.`)
  }

  const signedDataHolder = findContextTagged(contentParts, 0)
  if (signedDataHolder === undefined) throw new DerError('No SignedData in the token.')
  const signedData = expect(readNode(signedDataHolder.contents), TAG.sequence, 'the SignedData')
  const signedParts = readChildren(signedData.contents)

  // version, digestAlgorithms, encapContentInfo, ...
  const encap = expect(signedParts[2], TAG.sequence, 'the encapContentInfo')
  const encapParts = readChildren(encap.contents)
  const eContentType = readObjectIdentifier(
    expect(encapParts[0], TAG.objectIdentifier, 'the encapsulated content type'),
  )
  if (eContentType !== OID.tstInfo) {
    throw new DerError(`Expected TSTInfo inside the token, found ${eContentType}.`)
  }

  const eContentHolder = findContextTagged(encapParts, 0)
  if (eContentHolder === undefined) throw new DerError('The token carries no TSTInfo.')
  const eContent = expect(readNode(eContentHolder.contents), TAG.octetString, 'the TSTInfo bytes')
  const tstInfo = expect(readNode(eContent.contents), TAG.sequence, 'the TSTInfo')
  const fields = readChildren(tstInfo.contents)

  const policyOid = readObjectIdentifier(expect(fields[1], TAG.objectIdentifier, 'the policy'))
  const imprint = readChildren(expect(fields[2], TAG.sequence, 'the messageImprint').contents)
  const imprintSha256 = toHex(expect(imprint[1], TAG.octetString, 'the hashed message').contents)
  const serialNumber = readInteger(expect(fields[3], TAG.integer, 'the serial number')).toString()
  const genTime = readGeneralizedTime(expect(fields[4], TAG.generalizedTime, 'the genTime'))

  if (imprintSha256 !== asked.sha256.toLowerCase()) {
    throw new DerError(
      `The authority stamped ${imprintSha256}, which is not the seal we asked about.`,
    )
  }

  // `nonce` is optional and its position varies, because accuracy and ordering
  // in front of it are both optional too. Found by tag among the tail.
  const nonce = fields.slice(5).find((field) => field.tag === TAG.integer)
  if (nonce !== undefined && asked.nonce !== undefined) {
    const returned = readInteger(nonce).toString(16).padStart(asked.nonce.length, '0')
    if (returned !== asked.nonce.toLowerCase()) {
      throw new DerError('The nonce came back different: this is an answer to another question.')
    }
  }

  return {
    status,
    statusText,
    token: {
      token: Buffer.from(bytes).toString('base64'),
      genTime,
      serialNumber,
      policyOid,
      imprintSha256,
    },
  }
}
