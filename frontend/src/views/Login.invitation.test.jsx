// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const token = 'a'.repeat(43)
const mocks = vi.hoisted(() => {
  const state = { sheets: [], preview: null, registered: [], invitation: { token: 'a'.repeat(43), preview: null, selected: [], consent: false }, listeners: new Set(), passkeyLogin: vi.fn(), setUser: vi.fn(), adoptProfile: vi.fn(), setGuest: vi.fn(), pushState: vi.fn(), pullState: vi.fn() }
  state.store = () => ({ config: { managed_subscriptions: true, allow_guest: false }, S: { workouts: [] }, setUser: state.setUser, adoptProfile: state.adoptProfile, setGuest: state.setGuest, loadConfig: vi.fn(async () => state.store().config), pushState: state.pushState, pullState: state.pullState })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.store()) : mocks.store()
  useStore.getState = mocks.store
  return { useStore, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snapshot = () => ({ toast: vi.fn(), openSheet: render => { mocks.sheets.push(render); return {} } })
  const useUI = selector => selector ? selector(snapshot()) : snapshot()
  useUI.getState = snapshot
  return { useUI }
})
vi.mock('../lib/api.js', () => ({
  webauthnOK: () => true, bio: () => 'your fingerprint', passkeyError: error => error.message,
  api: (...args) => mocks.preview(...args), passkeyLogin: (...args) => mocks.passkeyLogin(...args),
  passkeyRegister: vi.fn(async (...args) => { mocks.registered.push(args); return { id: 'new-account', name: 'Nuevo' } }),
}))
vi.mock('../lib/invitation-receiver.js', () => ({
  currentInvitation: () => mocks.invitation,
  updateInvitation: patch => { mocks.invitation = { ...mocks.invitation, ...patch }; mocks.listeners.forEach(listener => listener()); return mocks.invitation },
  clearInvitation: () => { mocks.invitation = null; mocks.listeners.forEach(listener => listener()) },
  subscribeInvitation: listener => { mocks.listeners.add(listener); return () => mocks.listeners.delete(listener) },
}))
vi.mock('../lib/managed-bridge.js', () => ({ managedModeHint: () => false }))
vi.mock('../lib/demo.js', () => ({ DEMO: false, REPO: 'https://example.invalid' }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn() }))

const { default: Login } = await import('./Login.jsx')
let host, root
globalThis.IS_REACT_ACT_ENVIRONMENT = true
beforeEach(() => {
  mocks.sheets.length = 0; mocks.registered.length = 0
  for (const fn of [mocks.passkeyLogin, mocks.setUser, mocks.adoptProfile, mocks.setGuest, mocks.pushState, mocks.pullState]) fn.mockReset()
  mocks.invitation = { token, preview: null, selected: [], consent: false }
  mocks.preview = vi.fn(async () => ({ trainer: { id: 'trainer-opaque-id' }, purpose: 'training-follow-up', categories: ['PLAN', 'EXECUTION'], expiresAt: '2027-01-01T00:00:00.000Z', invitationVersion: 4, proposedGrants: [{ kind: 'PLAN' }, { kind: 'EXECUTION' }] }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root?.unmount()); host?.remove() })
const button = (node, text) => [...node.querySelectorAll('button')].find(item => item.textContent.trim() === text)

describe('Login invitation receiver (controlled WebAuthn transport unit)', () => {
  it('previews only public metadata and requires explicit grant selection before invite-bound passkey registration', async () => {
    await act(async () => { root.render(<Login />); await Promise.resolve() })
    await vi.waitFor(() => expect(host.textContent).toContain('training-follow-up'))
    expect(mocks.preview).toHaveBeenCalledWith('/api/invitations/preview', expect.objectContaining({ method: 'POST' }))
    expect(button(host, 'Create new profile').disabled).toBe(true)
    const choices = host.querySelectorAll('[data-invitation-consent] input')
    await act(async () => { choices[0].click(); choices[1].click(); choices[2].click() })
    expect(button(host, 'Create new profile').disabled).toBe(false)
    act(() => button(host, 'Create new profile').click())
    const sheetHost = document.createElement('div'); document.body.append(sheetHost); const sheetRoot = createRoot(sheetHost)
    await act(async () => { sheetRoot.render(mocks.sheets[0](() => {})); await Promise.resolve() })
    const name = sheetHost.querySelector('input[placeholder="Your name"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    await act(async () => { setter.call(name, 'Nueva persona'); name.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'Nueva persona', inputType: 'insertText' })); button(sheetHost, 'Create passkey').click(); await Promise.resolve() })
    expect(mocks.registered).toEqual([['Nueva persona', '', token]])
    act(() => { sheetRoot.unmount(); sheetHost.remove() })
  })

  it('does not start legacy profile adoption after managed passkey sign-in', async () => {
    mocks.invitation = null
    mocks.passkeyLogin.mockResolvedValue({ id: 'managed-user', name: 'Nueva' })
    await act(async () => { root.render(<Login />); await Promise.resolve() })
    await act(async () => { button(host, 'Sign in with passkey').click(); await Promise.resolve() })
    expect(mocks.setUser).toHaveBeenCalledWith({ id: 'managed-user', name: 'Nueva' }, undefined)
    expect(mocks.adoptProfile).not.toHaveBeenCalled()
  })
})
