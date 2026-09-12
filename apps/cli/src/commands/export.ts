import { writeFileSync } from 'node:fs'
import type { Command } from './registry.js'
import { optionOf, requireOption } from './registry.js'

/**
 * The XAF, and therefore the backup (spec 10.4).
 *
 * Spec 10.4 lists "run a backup" and "export an XAF" separately. For this
 * product they are close to the same act: the auditfile is the complete,
 * portable, schema-validated record of a book year, and it is the artefact
 * principle 4 is about — "your data leaves Klopt whenever you want".
 *
 * A `pg_dump` is a different thing and deliberately not here. It is a copy of
 * our storage, readable only by this software at this version; the auditfile is
 * readable by an accountant, an inspector and every competitor. If a backup is
 * only restorable into the thing that made it, it is a hostage, not a backup.
 */
export const exportAuditFile: Command = {
  name: 'export',
  summary: 'Write the XAF 3.2 auditfile for a book year.',
  usage: 'klopt export --year 2026 [--out auditfile.xml] [--from 1 --to 12]',
  options: { year: 'string', out: 'string', from: 'string', to: 'string' },
  operations: ['export.auditFile'],

  async run({ client, args, out, err }) {
    if (client === null) {
      err('Not signed in. Run `klopt login`, or set KLOPT_TOKEN.')
      return 1
    }

    const year = requireOption(args, 'year')
    const xml = await client.getText('/exports/audit-file', {
      fiscalYear: year,
      fromPeriod: optionOf(args, 'from'),
      toPeriod: optionOf(args, 'to'),
    })

    const target = optionOf(args, 'out')
    if (target === undefined) {
      // To stdout, so it pipes. `klopt export --year 2026 | gzip > x.gz` is the
      // whole reason a CLI is worth having over a download button.
      process.stdout.write(xml)
      return 0
    }

    writeFileSync(target, xml)
    out(`Wrote ${target} (${String(xml.length)} bytes).`)
    return 0
  },
}
