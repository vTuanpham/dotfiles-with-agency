// The one line that says what a finished worker reported, for its row and card. Pure.

/** A line of table (a row or its rule), a code fence or a blank: scaffolding, not what the worker said. */
const scaffolding = (line: string) => line === '' || line.startsWith('|') || line.startsWith('```')

/**
 * The first line of prose in a worker's final message, with its markdown dressing (heading marks, quote marks, bullets,
 * emphasis) taken off. A report that is only a table has no such line: it says so, rather than printing the table's header.
 */
export function summaryOf(message: string, limit = 160): string {
  const clean = (line: string) => line.replace(/^(#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '').replace(/[*_`]/g, '').trim()
  const lines = message.split('\n').map(line => line.trim()).filter(line => !scaffolding(line))
  const prose = lines.find(line => !line.startsWith('#') && clean(line)) // a heading only names a section
  if (prose) return clean(prose).slice(0, limit)
  const heading = lines.map(clean).find(Boolean)
  if (heading) return heading.slice(0, limit)
  const rows = message.split('\n').filter(line => line.trim().startsWith('|')).length
  return rows > 0 ? `Report is a ${Math.max(0, rows - 2)}-row table; open it with review.` : ''
}
