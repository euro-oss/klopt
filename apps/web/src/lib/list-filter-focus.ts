/**
 * `/` focuses the list filter (#107).
 *
 * List pages mark their filter control with `data-list-filter`. This helper is
 * what the global shortcut calls; screens do not bind `/` themselves.
 */

export function focusListFilter(root: ParentNode = document): boolean {
  const el = root.querySelector<HTMLElement>('[data-list-filter]')
  if (el === null) return false
  if (typeof el.focus === 'function') {
    el.focus()
    return true
  }
  return false
}
