import { createFileRoute } from '@tanstack/react-router'
import { handleGetInvoiceUbl } from '~/api/handlers/sales'
import { getDatabase } from '~/api/database'
import { resolveRequestContext } from '~/api/auth'
import { problemResponse } from '~/api/errors'

/**
 * The legal invoice, as XML (spec 7.5). Returns UBL rather than JSON for the
 * same reason the auditfile does: `curl -O` should do the obvious thing, and
 * what comes out has to be the exact bytes that would be sent.
 */
export const Route = createFileRoute('/api/v1/sales-invoices/$invoiceId/ubl')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        let requestId: string | null = request.headers.get('x-request-id')
        try {
          const context = await resolveRequestContext({ database: getDatabase(), request })
          requestId = context.requestId

          const result = await handleGetInvoiceUbl(context, params.invoiceId)

          return new Response(result.xml, {
            status: 200,
            headers: {
              'content-type': 'application/xml; charset=utf-8',
              'content-disposition': `attachment; filename="${result.filename}"`,
              'x-klopt-ubl-profile': result.profile,
              'x-request-id': context.requestId,
            },
          })
        } catch (error: unknown) {
          return problemResponse(error, requestId)
        }
      },
    },
  },
})
