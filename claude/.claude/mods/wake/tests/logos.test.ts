import { expect, test } from 'claude-code/testing'
import { LOGOS, modelLogo } from '../hooks/logos'

test('logos are PNG bytes for each supported harness', () => {
  for (const backend of ['codex', 'agy', 'claude', 'opencode'])
    expect(LOGOS[backend]?.startsWith('iVBORw0KGgo')).toBe(true)
})

test('every logo is a whole, decodable 32 by 32 image (a corrupt one draws nothing, silently)', () => {
  for (const [backend, data] of Object.entries(LOGOS)) {
    const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0))
    const view = new DataView(bytes.buffer)
    const chunks: { type: string; body: Uint8Array }[] = []
    for (let at = 8; at < bytes.length;) {
      const length = view.getUint32(at)
      const checked = bytes.slice(at + 4, at + 8 + length) // the type and the body: what the chunk's CRC covers
      expect(crc32(checked), `${backend} ${String.fromCharCode(...checked.slice(0, 4))} chunk`).toBe(view.getUint32(at + 8 + length))
      chunks.push({ type: String.fromCharCode(...checked.slice(0, 4)), body: checked.slice(4) })
      at += 12 + length
    }
    expect(chunks[0]?.type, backend).toBe('IHDR')
    expect(chunks.at(-1)?.type, backend).toBe('IEND')
    const header = new DataView(chunks[0]!.body.buffer, chunks[0]!.body.byteOffset)
    expect([header.getUint32(0), header.getUint32(4)], backend).toEqual([32, 32])
  }
})

/** PNG's checksum (CRC-32), to tell a whole chunk from one a stray edit damaged. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

test('model marks follow known model IDs rather than the harness', () => {
  expect(modelLogo('claude-sonnet-5-5')).toBe('claude')
  expect(modelLogo('openrouter/anthropic/claude-sonnet-5-5')).toBe('claude')
  expect(modelLogo('gpt-6.1-terra')).toBe('codex')
  expect(modelLogo('openrouter/openai/gpt-6-sol')).toBe('codex')
  expect(modelLogo('openrouter/other/gpt-6-sol')).toBeUndefined()
  expect(modelLogo('openai/claude-sonnet-5-5')).toBeUndefined()
  expect(modelLogo('anthropic/gpt-6-sol')).toBeUndefined()
  expect(modelLogo('openrouter/gpt-6-sol')).toBeUndefined()
  expect(modelLogo('/gpt-6-sol')).toBeUndefined()
  expect(modelLogo('sonnet')).toBeUndefined()
  expect(modelLogo('gemini-3-flash')).toBeUndefined()
  expect(modelLogo('unknown-model')).toBeUndefined()
  expect(modelLogo(undefined)).toBeUndefined()
})
