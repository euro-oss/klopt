/**
 * Sending email, as a port.
 *
 * In core rather than in adapters because both sides need it and neither may
 * depend on the other: `@klopt/db` wires sign-in codes, `@klopt/adapters`
 * implements SMTP, and the boundary rules forbid db from importing adapters.
 * A port in core is exactly the shape that resolves it.
 *
 * ADR 0008 defers the *compliance* ports until the domain types they carry
 * exist. This one carries none — a message is a subject and some text — so
 * there is nothing to wait for.
 */

export interface EmailAttachment {
  readonly filename: string
  readonly contentType: string
  readonly content: Uint8Array | string
}

export interface EmailMessage {
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly html?: string
  readonly replyTo?: string
  readonly attachments?: readonly EmailAttachment[]
  /**
   * Set for a message carrying a legal document. The transport records it so
   * the evidence chain can show what was sent and when (spec 8, rule 3).
   */
  readonly reference?: string
}

export interface EmailResult {
  readonly delivered: boolean
  /** The transport's own id, for the evidence chain. */
  readonly messageId: string | null
  readonly transport: string
}

export interface EmailTransport {
  readonly name: string
  send(message: EmailMessage): Promise<EmailResult>
}
