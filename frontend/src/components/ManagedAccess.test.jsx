// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManagedAccessBoundary } from './ManagedAccess.jsx'

const answer = (overrides = {}) => ({ account: { id: 'operator', activity: 'ACTIVE' }, managedSubscriptions: true, roles: ['COORDINATOR'], entitlement: { active: false, startUtc: null, endExclusiveUtc: null, version: 0 }, capabilities: ['MANAGE_OPERATIONAL_ROLES'], compatibility: { protectedTraining: 'supported' }, requestId: 'r', versionTokens: [], ...overrides })
let host, root
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null })

describe('ManagedAccessBoundary (unit)', () => {
  it('keeps an expired operational administrator out of personal content but exposes the authorized entry', async () => {
    const dispose = vi.fn()
    const api = { getAccess: vi.fn(async () => answer()), dispose }
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => { root.render(<MemoryRouter><ManagedAccessBoundary account={{ id: 'operator' }} createClient={() => api}>{() => 'personal content'}</ManagedAccessBoundary></MemoryRouter>); await Promise.resolve() })
    expect(host.textContent).toContain('Acceso de entrenamiento no disponible')
    expect(host.textContent).toContain('Administración operativa')
    expect(host.textContent).not.toContain('personal content')
    act(() => root.unmount())
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('disposes the old per-account client and ignores its late authority answer', async () => {
    let finish
    const old = { getAccess: vi.fn(() => new Promise(resolve => { finish = resolve })), dispose: vi.fn() }
    const next = { getAccess: vi.fn(async () => answer({ account: { id: 'next', activity: 'ACTIVE' }, managedSubscriptions: false, roles: ['CLIENT'], entitlement: { active: false, startUtc: null, endExclusiveUtc: null, version: 0 }, capabilities: [] })), dispose: vi.fn() }
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => { root.render(<MemoryRouter><ManagedAccessBoundary account={{ id: 'old' }} createClient={() => old}>{() => 'old body'}</ManagedAccessBoundary></MemoryRouter>); await Promise.resolve() })
    await act(async () => { root.render(<MemoryRouter><ManagedAccessBoundary account={{ id: 'next' }} createClient={() => next}>{() => 'next body'}</ManagedAccessBoundary></MemoryRouter>); await Promise.resolve() })
    finish(answer({ account: { id: 'old', activity: 'ACTIVE' } }))
    await act(async () => { await Promise.resolve() })
    expect(old.dispose).toHaveBeenCalledOnce()
    expect(host.textContent).toContain('next body')
    expect(host.textContent).not.toContain('old body')
  })
})
