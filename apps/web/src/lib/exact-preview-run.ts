export type ExactPreviewRunOutcome =
  | { readonly kind: 'success'; readonly data: Record<string, unknown> }
  | { readonly kind: 'failure' }

export function exactPreviewStateAfterRun(outcome: ExactPreviewRunOutcome): {
  readonly preview: Record<string, unknown> | null
  readonly loadFailed: boolean
} {
  if (outcome.kind === 'success') {
    return { preview: outcome.data, loadFailed: false }
  }
  return { preview: null, loadFailed: true }
}

export async function runExactPreviewLoad(
  load: () => Promise<{
    readonly ok: boolean
    readonly data?: Record<string, unknown>
  }>,
): Promise<ExactPreviewRunOutcome> {
  try {
    const result = await load()
    if (!result.ok || result.data === undefined) return { kind: 'failure' }
    return { kind: 'success', data: result.data }
  } catch {
    return { kind: 'failure' }
  }
}
