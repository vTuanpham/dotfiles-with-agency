// Local visual review: serve only the review assets; feedback stays in the ignored local folder.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const data = process.env.WAKE_REVIEW_DATA ?? resolve(import.meta.dir, '../../../../../feedback.local/wake-review')
await mkdir(data, { recursive: true, mode: 0o700 })
let saved: { drafts: Record<string, unknown>; submissions: unknown[] } = { drafts: {}, submissions: [] }
try { saved = JSON.parse(await readFile(data + '/feedback.json', 'utf8')) }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
let writing = Promise.resolve()
const server = Bun.serve({
  hostname: '127.0.0.1', port: Number(process.env.PORT ?? 18761), maxRequestBodySize: 128 * 1024,
  async fetch(request) {
    const url = new URL(request.url)
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    if (request.method === 'GET' && ['/', '/before'].includes(url.pathname)) {
      const previous = url.pathname === '/before', available = await Bun.file(data + '/before.js').exists()
      if (previous && !available) return new Response('No saved baseline', { status: 404 })
      let html = await Bun.file(import.meta.dir + '/review.html').text()
      html = html.replace('<!-- versions -->', available ? '<p><a href="/">Revised scene</a> · <a href="/before">Before this overhaul</a></p>' : '')
      if (previous) html = html.replace('Review the revised scene.', 'Saved scene before the overhaul.').replace('src="/review.js"', 'src="/before.js"')
      return new Response(html, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } })
    }
    if (request.method === 'GET' && url.pathname === '/before.js' && await Bun.file(data + '/before.js').exists()) return new Response(Bun.file(data + '/before.js'), { headers: { ...headers, 'Content-Type': 'text/javascript' } })
    if (request.method === 'GET' && url.pathname === '/review.js') {
      const build = await Bun.build({ entrypoints: [import.meta.dir + '/review.ts'], target: 'browser', minify: true })
      if (!build.success) return new Response('Preview build failed', { status: 500 })
      return new Response(build.outputs[0], { headers: { ...headers, 'Content-Type': 'text/javascript' } })
    }
    if (request.method === 'GET' && url.pathname === '/feedback') return Response.json(saved, { headers })
    if (request.method !== 'POST' || !['/drafts', '/submit'].includes(url.pathname)) return new Response('Not found', { status: 404 })
    try {
      const origin = request.headers.get('Origin')
      if (!origin || new URL(origin).host !== request.headers.get('Host')) return new Response('Origin mismatch', { status: 403 })
      const input = await request.json()
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 100) throw new Error('Invalid drafts')
      for (const [key, note] of Object.entries(input)) {
        const n = note as Record<string, unknown>
        if (!/^[a-z0-9-]{1,80}$/.test(key) || !n || typeof n !== 'object' || typeof n.text !== 'string' || n.text.length > 12000
            || typeof n.at !== 'number' || !Number.isFinite(n.at) || n.at < 0 || n.at > 16000
            || !n.config || typeof n.config !== 'object' || Array.isArray(n.config)) throw new Error('Invalid note')
        const c = n.config as Record<string, unknown>
        if (!['city', 'harbor', 'beach', 'mountains', 'countryside', 'forest', 'desert', 'tundra'].includes(String(c.place))
            || !['codex', 'claude', 'agy', 'opencode'].includes(String(c.family))
            || ![1, 2, 3, 4].includes(c.tier as number) || ![14, 22].includes(c.hour as number)
            || ![72, 120, 190].includes(c.width as number)
            || !['cruise', 'to', 'from', 'peer', 'burst', 'arrive', 'leave', 'strike', 'rest', 'crowd', 'depth'].includes(String(c.mode))) throw new Error('Invalid scene')
      }
      const at = new Date().toISOString()
      // Serialize writes so a slow autosave cannot overwrite a later submission on disk.
      writing = writing.catch(() => {}).then(async () => {
        const next = { drafts: input, submissions: url.pathname === '/submit'
          ? [...saved.submissions, { at, drafts: input }] : saved.submissions }
        await writeFile(data + '/feedback.tmp', JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
        await rename(data + '/feedback.tmp', data + '/feedback.json')
        saved = next
      })
      await writing
      return Response.json({ ok: true, at }, { headers })
    } catch { return new Response('Could not save feedback', { status: 400 }) }
  },
})
console.log(`Wake review: http://127.0.0.1:${server.port}\nFeedback: ${data}/feedback.json`)
