import type { Request } from '@playwright/test'

const PREVIEW_EXACT_HANDLER = 'previewExactImport_createServerFn_handler'

function exportFromServerFnUrl(url: string): string | null {
  const encoded = url.match(/\/_serverFn\/([^?]+)/)?.[1]
  if (encoded === undefined) return null
  try {
    const meta = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as {
      export?: string
    }
    return meta.export ?? null
  } catch {
    return null
  }
}

/**
 * True when this GET is TanStack `previewExactImport`.
 *
 * Dev URLs are `/_serverFn/<base64 json>?payload=…` with
 * `export: previewExactImport_createServerFn_handler`, not the plain export name.
 */
export function isExactPreviewRequest(request: Request): boolean {
  if (request.method() !== 'GET') return false
  const url = request.url()
  if (url.includes('previewExactImport')) return true
  const exportName = exportFromServerFnUrl(url)
  if (exportName === PREVIEW_EXACT_HANDLER) return true
  // Prod / hashed ids: stable fragment inside the dev base64 JSON export field.
  if (url.includes('/_serverFn/') && url.includes('InByZXZpZXdFeGFjdEltcG9ydF')) return true
  return false
}
