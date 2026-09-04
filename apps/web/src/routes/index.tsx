import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Klopt</h1>
      <p className="text-muted-foreground mt-2">
        Open bookkeeping for the Dutch market. Nothing is booked yet — the ledger arrives in M0.
      </p>
    </main>
  )
}
