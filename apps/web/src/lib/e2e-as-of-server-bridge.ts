import { getRequest, getRequestHeader } from '@tanstack/react-start/server'
import { bindE2eAsOfHeaderReader, hasE2eAsOfHeaderReader } from './e2e-as-of-request.js'
import { parseE2eAsOfHeader } from './e2e-as-of-header.js'

const E2E_AS_OF_COOKIE = 'klopt-e2e-as-of'

function readE2eAsOfCookie(rawCookie: string | null | undefined): string | undefined {
  const match = new RegExp(`(?:^|;\\s*)${E2E_AS_OF_COOKIE}=([^;]*)`).exec(rawCookie ?? '')
  const value = match?.[1]
  if (value === undefined) return undefined
  return parseE2eAsOfHeader(decodeURIComponent(value))
}

function readHeader(name: string): string | undefined {
  const fromStart = getRequestHeader(name)
  if (fromStart !== undefined && fromStart !== '') return fromStart
  try {
    const request = getRequest()
    const direct = request.headers.get(name)
    if (direct !== null && direct !== '') return direct
    return readE2eAsOfCookie(request.headers.get('cookie'))
  } catch {
    return undefined
  }
}

export function ensureE2eAsOfServerBridge(): void {
  if (hasE2eAsOfHeaderReader()) return
  bindE2eAsOfHeaderReader(readHeader)
}
