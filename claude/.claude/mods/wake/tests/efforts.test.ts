import { expect, test } from 'claude-code/testing'
import { effortDots, levelsFor, readInventory } from '../hooks/sources/efforts'

test('effort levels come from the native inventory, never a fixed scale', () => {
  const codex = readInventory('codex', JSON.stringify({ models: [
    { id: 'gpt-6.1-sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
    { id: 'mystery', efforts: null },
  ] }))
  expect(codex['gpt-6.1-sol']).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
  expect(codex.mystery).toBeUndefined() // unknown stays unknown
  // Antigravity puts the level in the model ID: sibling IDs give the scale, and a Gemini tops out at high
  const agy = readInventory('agy', JSON.stringify({ models: [
    { id: 'gemini-3.8-flash-high', efforts: null }, { id: 'gemini-3.8-flash-low', efforts: null }, { id: 'gemini-3.8-flash-medium', efforts: null },
  ] }))
  expect(agy['gemini-3.8-flash']).toEqual(['low', 'medium', 'high'])
  expect(effortDots('high', agy['gemini-3.8-flash-high'])).toBe('●●●')
  expect(effortDots('high', codex['gpt-6.1-sol'])).toBe('●●●○○○')
  // malformed input is rejected rather than coerced
  expect(readInventory('codex', JSON.stringify({ models: [{ id: 'x', efforts: ['high', 'warp'] }] })).x).toBeUndefined()
  expect(readInventory('codex', JSON.stringify({ nope: 1 }))).toEqual({})
})

test('a full Claude model ID finds its native alias, and an effort off the scale shows no meter', () => {
  const claude = { claude: { opus: ['low', 'medium', 'high', 'xhigh', 'max'] } }
  expect(levelsFor(claude, 'claude', 'claude-opus-5-5')).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  expect(levelsFor(claude, 'claude', 'claude-haiku-5-5')).toBeUndefined()
  expect(effortDots('ultra', claude.claude.opus)).toBeUndefined()
})
