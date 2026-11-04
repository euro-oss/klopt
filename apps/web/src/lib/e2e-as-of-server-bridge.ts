import { getRequestHeader } from '@tanstack/react-start/server'
import { bindE2eAsOfHeaderReader, hasE2eAsOfHeaderReader } from './e2e-as-of-request.ts'

export function ensureE2eAsOfServerBridge(): void {
  if (hasE2eAsOfHeaderReader()) return
  bindE2eAsOfHeaderReader((name) => getRequestHeader(name))
}
