import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

/**
 * Credentials at rest (spec 8, rule 2: "per entity, encrypted, entered by the
 * operator").
 *
 * What this buys and what it does not, said plainly. A database dump, a
 * replica, a backup tape or a `select * from inbound_sources` does not hand
 * somebody a mailbox password. A compromised application process does, because
 * it holds the key — that is what "encrypted at rest" means everywhere, and
 * pretending otherwise would be worse than not encrypting.
 *
 * AES-256-GCM, so a ciphertext that has been tampered with fails to decrypt
 * rather than decrypting to something else. The key comes from
 * `KLOPT_ENCRYPTION_KEY` through scrypt, salted per value, so two identical
 * passwords do not produce identical ciphertext.
 *
 * ## No key means no secret, not a plaintext one
 *
 * Without a configured key, `encryptSecret` refuses. The alternative — falling
 * back to storing the password as it was typed — is the kind of quiet
 * degradation that is discovered by somebody else, later, in a dump. Refusing
 * is visible at the moment somebody sets the mailbox up, which is when it can
 * still be fixed, and it costs nothing in a default install: the drop-directory
 * source that ships as the default has no credential at all.
 */

const VERSION = 'v1'
const KEY_BYTES = 32
const SALT_BYTES = 16
const IV_BYTES = 12

export class SecretKeyMissingError extends Error {
  constructor() {
    super(
      'No KLOPT_ENCRYPTION_KEY is configured, so a password cannot be stored safely. Set it to a long random string, or use a drop directory, which needs no credential.',
    )
    this.name = 'SecretKeyMissingError'
  }
}

function keyMaterial(): string | null {
  const value = process.env['KLOPT_ENCRYPTION_KEY'] ?? ''
  return value.trim() === '' ? null : value
}

/** Whether a secret can be stored at all. What a settings screen asks first. */
export function secretsAvailable(): boolean {
  return keyMaterial() !== null
}

export function encryptSecret(plaintext: string): string {
  const material = keyMaterial()
  if (material === null) throw new SecretKeyMissingError()

  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const key = scryptSync(material, salt, KEY_BYTES)

  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    VERSION,
    salt.toString('base64url'),
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

/**
 * Read a stored secret back.
 *
 * Returns null rather than throwing when the value cannot be read — a key that
 * has been rotated, a row written before a key existed. The caller's answer to
 * that is "this mailbox needs its password entering again", which is a sentence
 * on a screen; a thrown error inside a poller is a job that fails every five
 * minutes and says nothing useful.
 */
export function decryptSecret(stored: string | null): string | null {
  if (stored === null || stored === '') return null

  const material = keyMaterial()
  if (material === null) return null

  const parts = stored.split('.')
  if (parts.length !== 5 || parts[0] !== VERSION) return null

  try {
    const salt = Buffer.from(parts[1]!, 'base64url')
    const iv = Buffer.from(parts[2]!, 'base64url')
    const tag = Buffer.from(parts[3]!, 'base64url')
    const ciphertext = Buffer.from(parts[4]!, 'base64url')

    const decipher = createDecipheriv('aes-256-gcm', scryptSync(material, salt, KEY_BYTES), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
