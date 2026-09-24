import { createFileRoute } from '@tanstack/react-router'
import { MAX_DOCUMENT_BYTES } from '@klopt/core'
import { handleListInbox, handleReceiveDocument } from '~/api/handlers/inbox'
import { inboxQuery } from '~/api/schemas'
import { ApiError } from '~/api/errors'
import { handle, parse, searchParams } from '~/api/runtime'

/**
 * The purchase inbox, and putting something in it.
 *
 * The POST takes `multipart/form-data` — a document is bytes, and base64 inside
 * JSON would inflate every invoice by a third for no benefit. A mail gateway or
 * a Peppol access point posts here with `source` set accordingly; the browser
 * posts the same shape from a file input.
 *
 * `externalId` is what the sender calls this arrival — a Peppol transmission
 * id, a gateway's message id. Sending it makes the post safe to retry: the
 * second one answers 200 with `alreadyTaken` rather than filing the invoice a
 * second time. An access point that retries on a timeout, which they all do,
 * needs that.
 *
 * The size is checked against `File.size` before `arrayBuffer()` so one request
 * cannot allocate until the process dies (audit M5). The same cap lives in
 * `receiveDocument`.
 */
export const Route = createFileRoute('/api/v1/inbox')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handle(request, (context) =>
          handleListInbox(context, parse(inboxQuery, searchParams(request), 'The query string')),
        ),
      POST: ({ request }) =>
        handle(request, async (context) => {
          const form = await request.formData()
          const file = form.get('file')
          if (!(file instanceof File)) {
            throw new Error('Send the document as a `file` part in multipart/form-data.')
          }

          if (file.size > MAX_DOCUMENT_BYTES) {
            throw new ApiError(
              'validation_failed',
              `That file is larger than ${String(MAX_DOCUMENT_BYTES)} bytes, which is more than this inbox will take.`,
              [
                {
                  code: 'file_too_large',
                  path: 'file',
                  message: `Maximum size is ${String(MAX_DOCUMENT_BYTES)} bytes.`,
                },
              ],
            )
          }

          const text = (name: string): string | null => {
            const value = form.get(name)
            return typeof value === 'string' && value !== '' ? value : null
          }
          const source = text('source')

          return handleReceiveDocument(context, {
            bytes: new Uint8Array(await file.arrayBuffer()),
            filename: file.name === '' ? null : file.name,
            contentType: file.type === '' ? null : file.type,
            source: source === 'email' || source === 'peppol' ? source : 'upload',
            receivedFrom: text('receivedFrom'),
            subject: text('subject'),
            externalId: text('externalId'),
          })
        }),
    },
  },
})
