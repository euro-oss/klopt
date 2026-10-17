/**
 * Wait until at least `floorMs` have passed since `startedAt` (Date.now()).
 *
 * Used so a silent invite-only OTP refusal does not answer faster than the
 * work that precedes a real send — otherwise response time reveals whether
 * an address is invited.
 */
export async function floorElapsed(startedAt: number, floorMs: number): Promise<void> {
  const remaining = floorMs - (Date.now() - startedAt)
  if (remaining <= 0) return
  await new Promise<void>((resolve) => {
    setTimeout(resolve, remaining)
  })
}

/**
 * Floor for the silent send-verification-otp path when signup is closed.
 *
 * Long enough to cover a user lookup + invitation check on a typical host,
 * short enough not to annoy a real person typing an address that is not
 * invited. Tuned for constant-ish responses, not for load.
 */
export const SEND_OTP_SILENT_FLOOR_MS = 80
