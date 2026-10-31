/**
 * Dutch reminder email copy used by the e-invoice email transport and by the
 * Reminders preview (#107 Phase 2).
 *
 * One source of truth: the preview must show what will actually be sent.
 *
 * Legal (#107): do not claim collection costs (incassokosten) or statutory
 * interest unless the Dutch WIK / 14-day consumer letter is implemented.
 * Until then the final notice only asks for payment within fourteen days.
 */

export interface ReminderEmailInput {
  readonly invoiceNumber: string
  readonly total: string
  readonly currency: string
  readonly dueDate: string
  readonly stage: number
  readonly daysOverdue: number
}

export interface ReminderEmailCopy {
  readonly subject: string
  readonly text: string
}

export function reminderEmailCopy(input: ReminderEmailInput): ReminderEmailCopy {
  const label =
    input.stage === 1
      ? 'Betalingsherinnering'
      : input.stage === 2
        ? 'Tweede herinnering'
        : 'Laatste aanmaning'

  const body =
    input.stage === 1
      ? [
          `Onze factuur ${input.invoiceNumber} van ${input.total} ${input.currency} stond`,
          `op ${input.dueDate} open en is nog niet als betaald bij ons binnengekomen.`,
          '',
          'Mogelijk is deze aan uw aandacht ontsnapt. Heeft u de betaling inmiddels',
          'gedaan, dan kunt u dit bericht als niet verzonden beschouwen.',
        ]
      : input.stage === 2
        ? [
            `Factuur ${input.invoiceNumber} van ${input.total} ${input.currency} is nu`,
            `${String(input.daysOverdue)} dagen te laat. Wij hebben u hierover eerder bericht.`,
            '',
            'Wij verzoeken u het bedrag binnen veertien dagen te voldoen.',
          ]
        : [
            `Factuur ${input.invoiceNumber} van ${input.total} ${input.currency} is`,
            `${String(input.daysOverdue)} dagen te laat, ondanks eerdere herinneringen.`,
            '',
            'Wij verzoeken u het bedrag binnen veertien dagen te voldoen.',
          ]

  return {
    subject: `${label}: factuur ${input.invoiceNumber}`,
    text: [...body, '', 'De factuur is bijgevoegd.'].join('\n'),
  }
}
