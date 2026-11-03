import { describe, expect, it } from 'vitest'
import { internalErrorStackFrameLine } from '../../src/api/errors.js'

describe('internal-error stack frame allowlist', () => {
  it.each([
    '    at j.jansen:1:2',
    '    at foo.bar:1:2',
    '    at jansen.pdf:1:2',
    '    at Jan de Vries/x:1:2',
    '    at fn (Jan de Vries.nl:1:2)',
    '    at readQuery (postgres://u:pw@h:5432/x:1:2)',
    '    at relative (x/y.js:1:2)',
    '    at jansen.js:1:2',
    '    at node:j.jansen:1:2',
    '    at node:Jansen:1:2',
    '    at node:foo.bar:1:2',
    '    at node:jan@x:1:2',
  ])('drops %s', (line) => {
    expect(internalErrorStackFrameLine(line)).toBeNull()
  })

  it.each([
    [
      '    at /workspace/apps/web/src/api/errors.ts:10:5',
      '/workspace/apps/web/src/api/errors.ts:10:5',
    ],
    [
      '    at file:///workspace/apps/web/src/foo.js:1:1',
      'file:///workspace/apps/web/src/foo.js:1:1',
    ],
    ['    at node:internal/process/task_queues:95:5', 'node:internal/process/task_queues:95:5'],
    [
      '    at webpack-internal:///./src/routes/index.tsx:12:3',
      'webpack-internal:///./src/routes/index.tsx:12:3',
    ],
    ['    at https://cdn.example.com/app/main.js:1:2', 'https://cdn.example.com/app/main.js:1:2'],
    ['    at native', 'native'],
    ['    at <anonymous>', '<anonymous>'],
  ])('keeps allowed shape %s', (line, location) => {
    expect(internalErrorStackFrameLine(line)).toBe(location)
  })

  it('rewrites Windows and POSIX home profile segments before logging', () => {
    expect(internalErrorStackFrameLine('    at C:\\Users\\jjansen\\x.js:1:2')).toBe(
      'C:\\Users\\~\\x.js:1:2',
    )
    expect(internalErrorStackFrameLine('    at /home/jjansen/project/index.ts:3:4')).toBe(
      '/home/~/project/index.ts:3:4',
    )
    expect(internalErrorStackFrameLine('    at /Users/jjansen/project/index.ts:3:4')).toBe(
      '/Users/~/project/index.ts:3:4',
    )
  })

  it('strips query strings from http(s) and file URLs', () => {
    expect(
      internalErrorStackFrameLine('    at https://cdn.example.com/app/main.js?token=secret:1:2'),
    ).toBe('https://cdn.example.com/app/main.js:1:2')
  })
})
