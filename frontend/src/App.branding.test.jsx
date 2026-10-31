// @vitest-environment happy-dom
// Integration regression: persisted user colour data must not override the commercial palette.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import App from './App.jsx'
import { DEF, useStore } from './store/useStore.js'
import './index.css'
import './branding.css'

vi.mock('./lib/sound.js', () => ({ setPlayOnSilent: vi.fn(), setVibrate: vi.fn(), setAlarmBuzzer: vi.fn(), setNativeBuzzer: vi.fn() }))
vi.mock('./lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: vi.fn(() => Promise.resolve({})), beacon: vi.fn() }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, original, originalBoot, originalMatchMedia
beforeEach(() => {
  original = useStore.getState().S
  originalBoot = useStore.getState().boot
  useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), theme: 'light', accent: 'custom', accentCustom: '#ff00aa', ready: true }, boot: vi.fn() })
  originalMatchMedia = window.matchMedia
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useStore.setState({ S: original, boot: originalBoot })
  window.matchMedia = originalMatchMedia
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-accent')
  document.documentElement.removeAttribute('data-web-branding')
  for (const name of ['--acc', '--acc-2', '--on-acc', '--knob-ring']) document.documentElement.style.removeProperty(name)
})

describe('App branding integration', () => {
  it('keeps saved web preferences while the scoped sheet owns the brand tokens', async () => {
    document.documentElement.dataset.webBranding = 'true'
    await act(async () => { root.render(<App />); await Promise.resolve() })
    const de = document.documentElement
    expect(de.dataset.theme).toBe('light')
    // happy-dom does not resolve CSS custom properties; the mounted root must be free of
    // user-colour inline vars, while the shipped stylesheet provides the computed values.
    const css = readFileSync(resolve(process.cwd(), 'src/branding.css'), 'utf8').replace(/\s/g, '')
    expect(css).toContain(':root[data-web-branding="true"]')
    expect(css).toContain('--acc:#ffad2f')
    expect(css).toContain('--bg:#07003c')
    expect(de.style.getPropertyValue('--acc')).toBe('')
    expect(useStore.getState().S).toMatchObject({ theme: 'light', accent: 'custom', accentCustom: '#ff00aa' })

    act(() => useStore.setState({ S: { ...useStore.getState().S, theme: 'system' } }))
    await act(async () => { await Promise.resolve() })
    expect(de.dataset.theme).toBe('dark')
    expect(de.style.getPropertyValue('--acc')).toBe('')
    expect(useStore.getState().S.accentCustom).toBe('#ff00aa')

    act(() => useStore.setState({ S: { ...useStore.getState().S, theme: 'dark' } }))
    await act(async () => { await Promise.resolve() })
    expect(de.dataset.theme).toBe('dark')
    expect(useStore.getState().S.theme).toBe('dark')
  })
})
