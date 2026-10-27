import { createFileRoute } from '@tanstack/react-router'
import { handleGetImportAdministrationMappings } from '~/api/handlers/import-wizard'
import { importWizardMappingsQuery } from '~/api/schemas'
import { handle, parse, searchParams } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/import-wizard/mappings')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, async (context) =>
          handleGetImportAdministrationMappings(
            context,
            parse(importWizardMappingsQuery, searchParams(request), 'The query string'),
          ),
        ),
    },
  },
})
