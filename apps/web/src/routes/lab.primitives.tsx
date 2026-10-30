import { createFileRoute, notFound } from '@tanstack/react-router'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Keycap } from '~/components/ui/keycap'
import { useSyncExternalStore } from 'react'

/**
 * Keyboard / focus / token lab for the redesign (#63 / #107 Phase 0).
 *
 * Only registered in Vite dev (the e2e webServer). Production builds 404 so
 * the page never ships. Used by `e2e/focus-outline.spec.ts` and PR screenshots.
 */
export const Route = createFileRoute('/lab/primitives')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  component: PrimitivesLab,
})

function useHtmlDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const observer = new MutationObserver(onChange)
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
      return () => {
        observer.disconnect()
      }
    },
    () => document.documentElement.classList.contains('dark'),
    () => false,
  )
}

function PrimitivesLab() {
  const dark = useHtmlDark()

  return (
    <main className="bg-background text-foreground mx-auto flex max-w-2xl flex-col gap-8 p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Primitives lab</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Token sample and focus lab. Theme follows{' '}
            <code className="font-mono text-xs">.dark</code> on{' '}
            <code className="font-mono text-xs">&lt;html&gt;</code> ({dark ? 'dark' : 'light'}).
          </p>
        </div>
        <button
          type="button"
          data-testid="lab-theme-toggle"
          className="border-border hover:bg-muted focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring border px-3 py-2 text-sm"
          onClick={() => {
            document.documentElement.classList.toggle('dark')
          }}
        >
          {dark ? 'Licht' : 'Donker'}
        </button>
      </header>

      <section aria-label="Tokens" className="grid gap-3 sm:grid-cols-2">
        <Swatch name="ground" className="bg-ground" />
        <Swatch name="surface" className="bg-surface border-border border" />
        <Swatch name="brand" className="bg-brand text-accent-foreground" />
        <Swatch name="primary" className="bg-primary text-primary-foreground" />
        <Swatch name="danger" className="bg-destructive text-destructive-foreground" />
        <Swatch name="attention" className="bg-unreconciled text-primary-foreground" />
        <Swatch name="success" className="bg-success text-primary-foreground" />
        <Swatch name="info" className="bg-info text-primary-foreground" />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Controls</h2>
        <p className="text-muted-foreground text-sm">
          Tab through these. Focus must show a 2px solid <code className="font-mono">--ring</code>{' '}
          outline. Touch targets are ≥44px below md.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" data-testid="lab-primary-button">
            Opslaan
          </Button>
          <Button type="button" variant="outline">
            Annuleren
          </Button>
          <Button type="button" variant="attention">
            Attention
          </Button>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span>Veld</span>
          <Input data-testid="lab-input" name="lab" defaultValue="1.234,56" className="tabular" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Ongeldig</span>
          <Input data-testid="lab-input-invalid" name="lab-invalid" defaultValue="x" aria-invalid />
        </label>
        <div className="flex flex-wrap gap-2">
          <Badge tabIndex={0} data-testid="lab-badge" variant="success">
            Betaald
          </Badge>
          <Badge tabIndex={0} variant="destructive">
            Te laat
          </Badge>
          <Badge tabIndex={0} variant="info">
            Open
          </Badge>
          <Badge tabIndex={0} variant="attention">
            Attention
          </Badge>
        </div>
        <p className="text-sm">
          Chord example{' '}
          <span className="inline-flex gap-0.5">
            <Keycap>⌘</Keycap>
            <Keycap>K</Keycap>
          </span>
        </p>
        <Alert>
          <AlertTitle>Callout</AlertTitle>
          <AlertDescription>
            Mapped from export Callout → <code className="font-mono text-xs">ui/alert</code>.
          </AlertDescription>
        </Alert>
        <p>
          Accessible link:{' '}
          <a href="#lab" className="text-link">
            voorbeeldlink
          </a>
        </p>
        <button
          type="button"
          data-testid="lab-shell-trigger"
          className="border-border hover:bg-muted focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring border px-3 py-2 text-left text-sm"
        >
          Profielrij
        </button>
      </section>
    </main>
  )
}

function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <div
      className={`flex h-16 items-end p-2 text-xs font-medium ${className}`}
      style={{ borderRadius: 'var(--radius-md)' }}
    >
      {name}
    </div>
  )
}
