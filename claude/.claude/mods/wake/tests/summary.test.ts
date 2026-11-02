import { expect, test } from 'claude-code/testing'

import { summaryOf } from '../hooks/summary'

test('a finished worker is summarised by its first line of prose, never by table scaffolding', () => {
  const table = '| Step | Result | Output and status |\n|---|---|---|\n| 1 | Pass | ok |\n| 2 | Fail | no |'
  expect(summaryOf(table)).toBe('Report is a 2-row table; open it with review.')
  expect(summaryOf(`I reran the probes.\n\n${table}`)).toBe('I reran the probes.')
  expect(summaryOf(`${table}\n\nOne step failed: the scratch directory was missing.`)).toBe('One step failed: the scratch directory was missing.')
  expect(summaryOf('## Result\n\n**All six steps pass.**')).toBe('All six steps pass.') // a heading only names a section
  expect(summaryOf('## Result')).toBe('Result') // unless it is all there is
  expect(summaryOf('- fixed the parser\n- added a test')).toBe('fixed the parser')
  expect(summaryOf('')).toBe('')
  expect(summaryOf('x'.repeat(500))).toHaveLength(160)
})
