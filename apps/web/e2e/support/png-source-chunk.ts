import { crc32 } from 'node:zlib'

/** Insert a PNG tEXt chunk (key `Source`) before IEND. Value must be repo-relative (e.g. e2e/foo.spec.ts). */
export function withPngSourceChunk(png: Buffer, source: string): Buffer {
  const data = Buffer.concat([Buffer.from('Source\0', 'latin1'), Buffer.from(source, 'latin1')])
  const type = Buffer.from('tEXt', 'latin1')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])))
  const iend = png.length - 12
  return Buffer.concat([png.subarray(0, iend), len, type, data, crc, png.subarray(iend)])
}
