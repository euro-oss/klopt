/**
 * The class merger shadcn/ui components expect.
 *
 * Re-exported from the `cn` package rather than implemented here, because
 * `shadcn apply` generates components that import `from "cn"` directly. Having
 * our own five-line version as well would mean two mergers in one bundle and
 * a rule about which to use that nobody would remember.
 */
export { cn } from 'cn'
