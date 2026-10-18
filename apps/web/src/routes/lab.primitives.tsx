import { createFileRoute, notFound } from '@tanstack/react-router'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'

/**
 * Keyboard / focus lab for the redesign primitives (#63).
 *
 * Only registered in Vite dev (the e2e webServer). Production builds 404 so
 * the page never ships. Used by `e2e/focus-outline.spec.ts` to assert that
 * focus outlines actually paint — class-string checks missed `outline-none`
 * beating `outline-2` in Tailwind 4.
 */
export const Route = createFileRoute('/lab/primitives')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  component: PrimitivesLab,
})

function PrimitivesLab() {
  return (
    <main className="bg-background text-foreground mx-auto flex max-w-lg flex-col gap-6 p-8">
      <h1 className="text-lg font-semibold">Primitives lab</h1>
      <p className="text-muted-foreground text-sm">
        Tab through these controls. Focus must show a 2px solid `--ring` outline.
      </p>
      <Button type="button" data-testid="lab-primary-button">
        Opslaan
      </Button>
      <label className="flex flex-col gap-1 text-sm">
        <span>Veld</span>
        <Input data-testid="lab-input" name="lab" defaultValue="1.234,56" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>Ongeldig</span>
        <Input data-testid="lab-input-invalid" name="lab-invalid" defaultValue="x" aria-invalid />
      </label>
      <Badge tabIndex={0} data-testid="lab-badge" variant="success">
        Klopt
      </Badge>
    </main>
  )
}
