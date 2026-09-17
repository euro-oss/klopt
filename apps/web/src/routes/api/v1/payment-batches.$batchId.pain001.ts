import { createFileRoute } from '@tanstack/react-router'
import { handleGetBatchPain001 } from '~/api/handlers/payments'
import { getDatabase } from '~/api/database'
import { resolveRequestContext } from '~/api/auth'
import { problemResponse } from '~/api/errors'

/**
 * The payment file (spec 7.4). Returns XML rather than JSON so that uploading
 * it to a bank is a download and a drag, which is what a self-hoster does.
 *
 * A read: downloading twice is fine and sometimes necessary. Marking the batch
 * exported is a separate transition, so "did we already send this?" stays
 * answerable.
 */
export const Route = createFileRoute('/api/v1/payment-batches/$batchId/pain001')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        let requestId: string | null = request.headers.get('x-request-id')
        try {
          const context = await resolveRequestContext({ database: getDatabase(), request })
          requestId = context.requestId

          const result = await handleGetBatchPain001(context, params.batchId)

          return new Response(result.xml, {
            status: 200,
            headers: {
              'content-type': 'application/xml; charset=utf-8',
              'content-disposition': `attachment; filename="${result.filename}"`,
              // The hash of the exact bytes, so the evidence chain and the file
              // the bank received can be compared later.
              'x-klopt-document-hash': result.hash,
              'x-klopt-instruction-count': String(result.instructionCount),
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
