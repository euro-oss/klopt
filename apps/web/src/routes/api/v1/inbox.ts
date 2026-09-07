import { createFileRoute } from '@tanstack/react-router'
import { handleListInbox, handleReceiveDocument } from '~/api/handlers/inbox'
import { inboxQuery } from '~/api/schemas'
import { handle, parse, searchParams } from '~/api/runtime'

/**
 * The purchase inbox, and putting something in it.
 *
 * The POST takes `multipart/form-data` — a document is bytes, and base64 inside
 * JSON would inflate every invoice by a third for no benefit. A mail gateway or
 * a Peppol access point posts here with `source` set accordingly; the browser
 * posts the same shape from a file input.
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
          })
        }),
    },
  },
})
