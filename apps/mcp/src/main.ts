#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server.js'

/**
 * stdio, which is the local half of spec 10.3's transport requirement
 * ("stdio for local use, streamable HTTP for remote").
 *
 * The token comes from the environment rather than an argument, because a
 * bearer token on a command line is a bearer token in the shell history and in
 * every `ps` on the machine.
 */

const baseUrl = process.env['KLOPT_API_URL'] ?? 'http://localhost:3000'
const token = process.env['KLOPT_TOKEN'] ?? ''

if (token === '') {
  // stderr, never stdout: stdout is the protocol channel and anything written
  // there that is not a message corrupts the session.
  console.error(
    'KLOPT_TOKEN is not set. Issue a scoped token in Klopt under Toegang and export it. ' +
      'A read-only token is enough for every tool this server exposes.',
  )
  process.exit(1)
}

const server = createServer({ baseUrl, token })
await server.connect(new StdioServerTransport())
