import { createFileRoute, notFound } from '@tanstack/react-router'
import { useState, useSyncExternalStore } from 'react'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { ChoiceOption } from '~/components/ui/choice-option'
import { CodeChip } from '~/components/ui/code-chip'
import { DropZone } from '~/components/ui/drop-zone'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '~/components/ui/empty'
import { Input } from '~/components/ui/input'
import { Keycap } from '~/components/ui/keycap'
import { RadioGroup } from '~/components/ui/radio-group'
import { Stepper } from '~/components/ui/stepper'
import { Switch } from '~/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'

/**
 * Keyboard / focus / token lab for the redesign (#63 / #107 Phase 0).
 *
 * Shows every mapped Phase 0 component in light and dark. Only registered in
 * Vite dev (the e2e webServer). Production builds 404 so the page never ships.
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
  const [on, setOn] = useState(false)
  const [choice, setChoice] = useState('a')
  const [step, setStep] = useState(2)

  return (
    <main className="bg-background text-foreground mx-auto flex max-w-2xl flex-col gap-10 p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Primitives lab</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            All 20 Phase 0 components (#107). Theme follows{' '}
            <code className="font-mono text-xs">.dark</code> on{' '}
            <code className="font-mono text-xs">&lt;html&gt;</code> ({dark ? 'dark' : 'light'}).
          </p>
        </div>
        <button
          type="button"
          data-testid="lab-theme-toggle"
          tabIndex={-1}
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
        <Swatch name="attention" className="bg-status-attention-bg text-status-attention" />
        <Swatch name="success" className="bg-success text-primary-foreground" />
        <Swatch name="info" className="bg-info text-primary-foreground" />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Button · Badge · StatusPill · Input · Kbd</h2>
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
          Chord{' '}
          <span className="inline-flex gap-0.5">
            <Keycap>⌘</Keycap>
            <Keycap>K</Keycap>
          </span>
        </p>
        <button
          type="button"
          data-testid="lab-shell-trigger"
          className="border-border hover:bg-muted focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring border px-3 py-2 text-left text-sm"
        >
          Profielrij
        </button>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Switch · Tabs · Callout · Cover</h2>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm">
            <strong className="block">Toon boekhouddetail</strong>
            <span className="text-ink-muted">Grootboeknummers, RGS en btw-codes.</span>
          </span>
          <Switch
            checked={on}
            onCheckedChange={setOn}
            aria-label="Toon boekhouddetail"
            data-testid="lab-switch"
          />
        </div>
        <Tabs defaultValue="all">
          <TabsList variant="underline" aria-label="Voorbeeld underline">
            <TabsTrigger value="all">Alles</TabsTrigger>
            <TabsTrigger value="open">Open</TabsTrigger>
          </TabsList>
          <TabsContent value="all">Underline-tab Alles</TabsContent>
          <TabsContent value="open">Underline-tab Open</TabsContent>
        </Tabs>
        <Tabs defaultValue="all">
          <TabsList variant="segmented" aria-label="Voorbeeld segmented">
            <TabsTrigger value="all">Alles</TabsTrigger>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="paid">Betaald</TabsTrigger>
          </TabsList>
        </Tabs>
        <Alert variant="attention">
          <AlertTitle>Callout (warn)</AlertTitle>
          <AlertDescription>
            Attention uses the export WARN styling (`--status-attention`).
          </AlertDescription>
        </Alert>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Cover / empty</EmptyTitle>
            <EmptyDescription>Mapped from export Cover → ui/empty.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">
          CodeChip · DropZone · Menu · Stepper · ChoiceOption
        </h2>
        <div className="flex flex-wrap gap-2">
          <CodeChip>VH21</CodeChip>
          <CodeChip>BLimBanRba</CodeChip>
          <CodeChip>1100</CodeChip>
        </div>
        <DropZone
          title="Sleep een bankafschrift hierheen"
          description="CAMT.053 of MT940 — geen PDF- of fotolezen"
          chooseLabel="Kies een bestand"
          accept=".xml,.sta,.txt"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline">
              Menu openen
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Administraties</DropdownMenuLabel>
            <DropdownMenuItem>Demo BV</DropdownMenuItem>
            <DropdownMenuItem>Nieuwe administratie</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Boekjaar</DropdownMenuLabel>
            <DropdownMenuItem>2025</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Stepper
          aria-label="Importstappen"
          current={step}
          onJump={setStep}
          steps={[
            { id: '1', label: 'Bron' },
            { id: '2', label: 'Verbinden' },
            { id: '3', label: 'Jaren' },
            { id: '4', label: 'Voorbeeld' },
            { id: '5', label: 'Problemen' },
            { id: '6', label: 'Importeren' },
          ]}
        />
        <RadioGroup value={choice} onValueChange={setChoice} className="gap-2">
          <ChoiceOption value="a">Optie A</ChoiceOption>
          <ChoiceOption value="b">Optie B</ChoiceOption>
        </RadioGroup>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Shell chrome (in app)</h2>
        <p className="text-muted-foreground text-sm">
          NavItem, StatTile, TodoItem, CommandBar, PhoneTabBar and SubNav live in the app shell —
          open Home, Settings or a phone viewport to see them.
        </p>
        <p>
          Accessible link:{' '}
          <a href="#lab" className="text-link">
            voorbeeldlink
          </a>
        </p>
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
