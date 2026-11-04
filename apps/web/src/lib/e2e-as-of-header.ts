const ISO = /^\d{4}-\d{2}-\d{2}$/

export function parseE2eAsOfHeader(raw: string | null | undefined): string | undefined {
  const trimmed = raw?.trim()
  if (trimmed === undefined || trimmed === '') return undefined
  return ISO.test(trimmed) ? trimmed : undefined
}
