/**
 * How a stored document is handed back over HTTP (audit H1, L2).
 *
 * Only PDF and raster images are safe to show `inline` on the application
 * origin: an HTML or SVG body would run in the bookkeeper's session. Everything
 * else is forced to `attachment` with `nosniff`, so the browser downloads
 * rather than renders. The stored content type is still reported — a UBL is
 * still `application/xml` — but it is not trusted for display.
 */

const INLINE_SAFE = new Set(['application/pdf', 'image/png', 'image/jpeg'])

/** Strip the parameter half (`text/html; charset=utf-8` → `text/html`). */
export function baseContentType(contentType: string): string {
  return contentType.split(';')[0]?.trim().toLowerCase() ?? ''
}

export function isInlineSafeContentType(contentType: string): boolean {
  const base = baseContentType(contentType)
  return INLINE_SAFE.has(base) || base === 'image/jpg'
}

/**
 * A filename safe to put in `Content-Disposition`.
 *
 * Quotes and control characters break or inject the header parameter. RFC 5987
 * `filename*` carries the original characters; the quoted `filename` is the
 * ASCII fallback.
 */
export function sanitizeContentDispositionFilename(filename: string): string {
  const stripped = filename
    .replace(/["\\\r\n]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '_')
    .trim()
  return stripped === '' ? 'document' : stripped.slice(0, 200)
}

export function contentDispositionHeader(
  contentType: string,
  filename: string,
): { readonly disposition: 'inline' | 'attachment'; readonly header: string } {
  const safe = sanitizeContentDispositionFilename(filename)
  const disposition = isInlineSafeContentType(contentType) ? 'inline' : 'attachment'
  // RFC 5987: percent-encode, then keep what token grammar allows unescaped.
  const encoded = encodeURIComponent(safe).replace(
    /['()]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return {
    disposition,
    header: `${disposition}; filename="${safe}"; filename*=UTF-8''${encoded}`,
  }
}
