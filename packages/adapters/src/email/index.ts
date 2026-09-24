export {
  type EmailAttachment,
  type EmailMessage,
  type EmailResult,
  type EmailTransport,
  createLogEmailTransport,
  createMemoryEmailTransport,
} from './transport.js'

export {
  type SmtpConfig,
  SmtpConfigError,
  createSmtpEmailTransport,
  smtpConfigFromEnvironment,
  verifySmtp,
} from './smtp.js'

export { createFileEmailTransport } from './file.js'

export { resolveEmailTransport, ProductionLogEmailError } from './resolve.js'
