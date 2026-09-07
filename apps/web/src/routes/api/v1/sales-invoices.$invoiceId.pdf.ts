import { createFileRoute } from '@tanstack/react-router'
import { handleGetInvoicePdf } from '~/api/handlers/sales'
import { invoicePdfQuery } from '~/api/schemas'
import { parse, searchParams } from '~/api/runtime'
import { getDatabase } from '~/api/database'
import { resolveRequestContext } from '~/api/auth'
import { problemResponse } from '~/api/errors'

/**
 * The human-readable rendering. `?embedUbl=true` attaches the XML, which is
 * spec 7.5's fallback transport in one request.
 */
export const Route = createFileRoute('/api/v1/sales-invoices/$invoiceId/pdf')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        let requestId: string | null = request.headers.get('x-request-id')
        try {
          const context = await resolveRequestContext({ database: getDatabase(), request })
          requestId = context.requestId

          const query = parse(invoicePdfQuery, searchParams(request), 'The query string')
          const result = await handleGetInvoicePdf(context, params.invoiceId, query)

          // `Uint8Array<ArrayBufferLike>` is not a `BodyInit`; a fresh
          // ArrayBuffer-backed view is. Copying a few kilobytes is cheaper
          // than making the DOM types lie.
          const body = new Uint8Array(result.bytes)

          return new Response(body.buffer, {
            status: 200,
            headers: {
              'content-type': result.contentType,
              'content-disposition': `attachment; filename="${result.filename}"`,
              'x-klopt-embedded-ubl': String(result.embeddedUbl),
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
