import { createTransport, type Transporter } from 'nodemailer'
import type { EmailMessage, EmailResult, EmailTransport } from '@klopt/core'

/**
 * SMTP. The one email transport a self-hoster can actually run.
 *
 * No API keys, no vendor account, no per-message pricing — every hosting
 * provider gives you SMTP and most organisations already have a relay. That is
 * the whole reason it is the configured path rather than a provider SDK.
 */

export interface SmtpConfig {
  readonly host: string
  readonly port: number
  /** Implicit TLS. Port 465 is `true`; 587 uses STARTTLS and is `false`. */
  readonly secure: boolean
  readonly user?: string | undefined
  readonly password?: string | undefined
  readonly from: string
  /** Refuse a relay presenting an untrusted certificate. Leave on. */
  readonly rejectUnauthorized?: boolean | undefined
}

export class SmtpConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SmtpConfigError'
  }
}

/**
 * Read SMTP settings from the environment, or return null if none are set.
 *
 * Null rather than a throw: no configuration is a legitimate state — it means
 * the log transport — whereas *partial* configuration is a mistake worth
 * failing on, because half-configured mail fails silently at the worst moment.
 */
export function smtpConfigFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
): SmtpConfig | null {
  const host = environment['KLOPT_SMTP_HOST']
  if (host === undefined || host === '') return null

  const from = environment['KLOPT_SMTP_FROM']
  if (from === undefined || from === '') {
    throw new SmtpConfigError('KLOPT_SMTP_HOST is set but KLOPT_SMTP_FROM is not.')
  }

  const port = Number(environment['KLOPT_SMTP_PORT'] ?? '587')
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new SmtpConfigError(
      `KLOPT_SMTP_PORT is not a port number: ${String(environment['KLOPT_SMTP_PORT'])}`,
    )
  }

  const user = environment['KLOPT_SMTP_USER']
  const password = environment['KLOPT_SMTP_PASSWORD']
  if ((user === undefined) !== (password === undefined)) {
    throw new SmtpConfigError('Set both KLOPT_SMTP_USER and KLOPT_SMTP_PASSWORD, or neither.')
  }

  return {
    host,
    port,
    // Default from the port rather than making the operator reason about it.
    secure: (environment['KLOPT_SMTP_SECURE'] ?? String(port === 465)) === 'true',
    user,
    password,
    from,
    rejectUnauthorized: environment['KLOPT_SMTP_INSECURE_TLS'] !== 'true',
  }
}

export function createSmtpEmailTransport(config: SmtpConfig): EmailTransport {
  let transporter: Transporter | null = null

  const connect = (): Transporter => {
    transporter ??= createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      ...(config.user === undefined || config.password === undefined
        ? {}
        : { auth: { user: config.user, pass: config.password } }),
      tls: { rejectUnauthorized: config.rejectUnauthorized ?? true },
    })
    return transporter
  }

  return {
    name: 'smtp',

    async send(message: EmailMessage): Promise<EmailResult> {
      const info = await connect().sendMail({
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html === undefined ? {} : { html: message.html }),
        ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
        ...(message.attachments === undefined
          ? {}
          : {
              attachments: message.attachments.map((attachment) => ({
                filename: attachment.filename,
                contentType: attachment.contentType,
                content:
                  typeof attachment.content === 'string'
                    ? attachment.content
                    : Buffer.from(attachment.content),
              })),
            }),
      })

      return {
        delivered: true,
        messageId: typeof info.messageId === 'string' ? info.messageId : null,
        transport: 'smtp',
      }
    },
  }
}

/** Verify the relay accepts us. Worth running at boot, not per message. */
export async function verifySmtp(config: SmtpConfig): Promise<void> {
  const transporter = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user === undefined || config.password === undefined
      ? {}
      : { auth: { user: config.user, pass: config.password } }),
    tls: { rejectUnauthorized: config.rejectUnauthorized ?? true },
  })
  await transporter.verify()
  transporter.close()
}
