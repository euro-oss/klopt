#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'
import { run } from './run.js'

/**
 * The binary (spec 10.4).
 *
 * Everything real is in `run.ts`, which takes its world as an argument. This
 * file is the only part that knows about the actual process, and it is
 * deliberately too small to hold a bug.
 */

const code = await run({
  argv: process.argv.slice(2),
  env: process.env,
  out: (line) => {
    process.stdout.write(`${line}\n`)
  },
  err: (line) => {
    process.stderr.write(`${line}\n`)
  },
  prompt: async (question) => {
    // On stderr, so `klopt export --year 2026 > file.xml` still works when
    // something has to be asked: the prompt must not land in the file.
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    try {
      return await rl.question(question)
    } finally {
      rl.close()
    }
  },
})

process.exit(code)
