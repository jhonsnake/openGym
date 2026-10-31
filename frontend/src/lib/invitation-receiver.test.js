import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { takeInvitation } from './invitation-receiver.js'

const token = 'a'.repeat(43)

function firstInlineScript() {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const match = html.match(/<script>\s*([\s\S]*?)<\/script>/)
  if (!match) throw new Error('first inline receiver script missing')
  return match[1]
}

function runReceiver(hash) {
  const location = { pathname: '/gym/', search: '?route=keep', hash }
  const history = { replaceState: (_state, _title, url) => {
    const next = new URL(url, 'https://example.test')
    location.pathname = next.pathname
    location.search = next.search
    location.hash = next.hash
  } }
  const window = { location, history }
  Object.defineProperty(window, 'localStorage', { get: () => { throw new Error('receiver must run before storage') } })
  new Function('window', firstInlineScript())(window)
  return window
}

describe('invitation receiver bootstrap', () => {
  it('removes a valid invite fragment before any storage hook and releases its volatile token once', () => {
    const window = runReceiver(`#invite=${token}`)
    expect(window.location).toMatchObject({ pathname: '/gym/', search: '?route=keep', hash: '' })
    expect(takeInvitation(window)).toBe(token)
    expect(takeInvitation(window)).toBeNull()
  })

  it('removes malformed invite fragments without retaining their value or changing a normal hash route', () => {
    const malformed = runReceiver('#invite=not-a-token')
    expect(malformed.location.hash).toBe('')
    expect(takeInvitation(malformed)).toBeNull()

    const route = runReceiver('#/home?from=notification')
    expect(route.location.hash).toBe('#/home?from=notification')
    expect(takeInvitation(route)).toBeNull()
  })
})
