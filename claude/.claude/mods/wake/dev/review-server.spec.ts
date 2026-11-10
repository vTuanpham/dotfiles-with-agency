import { test, expect } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('review feedback stays local, survives restart, and preserves submitted snapshots', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wake-review-test-'))
  let proc: ReturnType<typeof Bun.spawn> | undefined
  const start = async () => {
    proc = Bun.spawn(['bun', import.meta.dir + '/review-server.ts'], { env: { ...process.env, PORT: '0', WAKE_REVIEW_DATA: dir }, stdout: 'pipe', stderr: 'pipe' })
    const reader = proc.stdout.getReader()
    let output = ''
    while (!/http:\/\/127\.0\.0\.1:\d+/.test(output)) {
      const part = await reader.read()
      if (part.done) throw new Error('Server exited before listening: ' + await new Response(proc.stderr).text())
      output += new TextDecoder().decode(part.value)
    }
    reader.releaseLock()
    return output.match(/http:\/\/127\.0\.0\.1:\d+/)![0]
  }
  const stop = async () => { proc?.kill(); await proc?.exited }
  try {
    let url = await start()
    const post = (path: string, body: unknown, origin = url) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) })
    const note = { 'trail-ahead': { text: 'Test feedback', at: 2700, config: { place: 'city', family: 'codex', tier: 3, hour: 22, width: 120, mode: 'to' } } }
    expect((await fetch(url + '/')).status).toBe(200)
    expect((await fetch(url + '/review.js')).headers.get('Content-Type')).toBe('text/javascript')
    expect((await fetch(url + '/before')).status).toBe(404)
    await writeFile(dir + '/before.js', '/* saved renderer */')
    expect(await (await fetch(url + '/before.js')).text()).toBe('/* saved renderer */')
    expect(await (await fetch(url + '/before')).text()).toContain('src="/before.js"')
    expect((await fetch(url + '/feedback.json')).status).toBe(404)
    expect((await post('/drafts', note, 'http://unrelated.invalid')).status).toBe(403)
    expect((await post('/drafts', { bad: { text: 'missing scene' } })).status).toBe(400)
    expect((await post('/drafts', note)).status).toBe(200)
    expect((await post('/submit', note)).status).toBe(200)
    note['trail-ahead'].text = 'Edited draft after sending'
    expect((await post('/drafts', note)).status).toBe(200)
    await stop(); url = await start()
    const restored = await (await fetch(url + '/feedback')).json()
    expect(restored.drafts['trail-ahead'].text).toBe('Edited draft after sending')
    expect(restored.submissions[0].drafts['trail-ahead'].text).toBe('Test feedback')
    expect(JSON.parse(await readFile(dir + '/feedback.json', 'utf8'))).toEqual(restored)
    expect((await stat(dir + '/feedback.json')).mode & 0o777).toBe(0o600)
  } finally { await stop(); await rm(dir, { recursive: true, force: true }) }
}, 15000)
