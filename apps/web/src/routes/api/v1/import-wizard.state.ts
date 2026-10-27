import { createFileRoute } from '@tanstack/react-router'
import {
  handleGetImportWizardState,
  handleResetImportWizardState,
  handleSaveImportWizardState,
} from '~/api/handlers/import-wizard'
import { resetImportWizardStateBody, saveImportWizardStateBody } from '~/api/schemas'
import { handle, parse, readJson } from '~/api/runtime'

export const Route = createFileRoute('/api/v1/import-wizard/state')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request, (context) => handleGetImportWizardState(context)),
      POST: ({ request }) =>
        handle(request, async (context) =>
          handleSaveImportWizardState(
            context,
            parse(saveImportWizardStateBody, await readJson(request), 'The request body'),
          ),
        ),
      DELETE: ({ request }) =>
        handle(request, async (context) => {
          parse(resetImportWizardStateBody, await readJson(request), 'The request body')
          return handleResetImportWizardState(context)
        }),
    },
  },
})
