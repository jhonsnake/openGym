// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const token = 'a'.repeat(43)
const relationId = '11111111-1111-4111-8111-111111111111'
const state = vi.hoisted(() => ({ invitation: null, listeners: new Set(), api: null }))
vi.mock('../lib/invitation-receiver.js', () => ({
  currentInvitation: () => state.invitation,
  updateInvitation: patch => { state.invitation = { ...state.invitation, ...patch }; state.listeners.forEach(listener => listener()); return state.invitation },
  clearInvitation: () => { state.invitation = null; state.listeners.forEach(listener => listener()) },
  subscribeInvitation: listener => { state.listeners.add(listener); return () => state.listeners.delete(listener) },
}))
vi.mock('../lib/authority-api.js', () => ({ createAuthorityApi: () => state.api, isUuidV4: value => /^[0-9a-f-]{36}$/i.test(value) }))

const { default: InvitationFlow, verifyAcceptedInvitationReadback } = await import('./InvitationFlow.jsx')
let host, root
globalThis.IS_REACT_ACT_ENVIRONMENT = true
beforeEach(() => {
  state.invitation = { token, preview: null, selected: [], consent: false }
  state.api = {
    previewInvitation: vi.fn(async () => ({ trainer: { id: 'trainer-public-id' }, purpose: 'training-follow-up', categories: ['PLAN', 'HISTORY', 'HISTORY', 'WEIGHT'], expiresAt: '2027-01-01T00:00:00.000Z', invitationVersion: 9, proposedGrants: [{ kind: 'PLAN' }, { kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-02-01T00:00:00.000Z' }, { kind: 'HISTORY', startUtc: '2026-03-01T00:00:00.000Z', endExclusiveUtc: '2026-04-01T00:00:00.000Z' }, { kind: 'WEIGHT' }] })),
    acceptInvitation: vi.fn(async () => ({ operationId: crypto.randomUUID() })),
    rejectInvitation: vi.fn(), getClientRelations: vi.fn(async () => ({ relations: [] })), retry: vi.fn(), dispose: vi.fn(),
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root?.unmount()); host?.remove() })

async function expectPendingReadbackToRemainUncertain(relations) {
  state.api.previewInvitation = vi.fn(async () => ({ trainer: { id: 'trainer-public-id' }, purpose: 'training-follow-up', categories: ['PLAN'], expiresAt: '2027-01-01T00:00:00.000Z', invitationVersion: 9, proposedGrants: [{ kind: 'PLAN' }] }))
  state.api.acceptInvitation = vi.fn(async ({ operationId }) => ({ operationId, entity: { type: 'relation', id: relationId, version: 3 }, result: { relationId, state: 'PENDING_CONFIRMATION' } }))
  state.api.getClientRelations = vi.fn(async () => ({ relations }))
  await act(async () => { root.render(<InvitationFlow />); await Promise.resolve() })
  await vi.waitFor(() => expect(host.querySelectorAll('input').length).toBe(2))
  await act(async () => { host.querySelectorAll('input')[0].click(); host.querySelectorAll('input')[1].click(); [...host.querySelectorAll('button')].find(button => button.textContent.includes('Aceptar')).click(); await Promise.resolve(); await Promise.resolve() })
  await vi.waitFor(() => expect(host.textContent).toContain('resultado es incierto'))
  expect(state.invitation).toMatchObject({ token, selected: [JSON.stringify({ kind: 'PLAN' })] })
  await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent.includes('Reintentar la misma operación')).click(); await Promise.resolve(); await Promise.resolve() })
  expect(state.api.acceptInvitation).toHaveBeenCalledTimes(1)
  expect(state.api.getClientRelations).toHaveBeenCalledTimes(2)
}

describe('InvitationFlow (controlled authority transport unit)', () => {
  it('keeps an invalid HISTORY body-weight selection correctable without mutating', async () => {
    state.api.previewInvitation = vi.fn(async () => ({ trainer: { id: 'trainer-public-id' }, purpose: 'training-follow-up', categories: ['HISTORY', 'WEIGHT'], expiresAt: '2027-01-01T00:00:00.000Z', invitationVersion: 9, proposedGrants: [{ kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-02-01T00:00:00.000Z', includeWeight: true }, { kind: 'WEIGHT' }] }))
    await act(async () => { root.render(<InvitationFlow />); await Promise.resolve() })
    await vi.waitFor(() => expect(host.querySelectorAll('input').length).toBe(3))
    await act(async () => { host.querySelectorAll('input')[0].click(); host.querySelectorAll('input')[2].click(); await Promise.resolve() })
    expect(host.querySelector('button.btn:not(.ghost)').disabled).toBe(true)
    expect(host.textContent).toContain('WEIGHT')
    expect(host.textContent).toContain('selecciona también')
    expect(state.api.acceptInvitation).not.toHaveBeenCalled()
    expect(state.api.retry).not.toHaveBeenCalled()
    expect(state.invitation.selected).toEqual([JSON.stringify({ kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-02-01T00:00:00.000Z', includeWeight: true })])
  })

  it('sends the exact HISTORY and independently selected WEIGHT subset', async () => {
    state.api.previewInvitation = vi.fn(async () => ({ trainer: { id: 'trainer-public-id' }, purpose: 'training-follow-up', categories: ['HISTORY', 'WEIGHT'], expiresAt: '2027-01-01T00:00:00.000Z', invitationVersion: 9, proposedGrants: [{ kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-02-01T00:00:00.000Z', includeWeight: true }, { kind: 'WEIGHT' }] }))
    await act(async () => { root.render(<InvitationFlow />); await Promise.resolve() })
    await vi.waitFor(() => expect(host.querySelectorAll('input').length).toBe(3))
    await act(async () => { host.querySelectorAll('input').forEach(input => input.click()); await Promise.resolve(); host.querySelector('button.btn:not(.ghost)').click(); await Promise.resolve() })
    expect(state.api.acceptInvitation).toHaveBeenCalledWith(expect.objectContaining({ payload: { token, grants: [{ kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-02-01T00:00:00.000Z', includeWeight: true }, { kind: 'WEIGHT' }] } }))
  })

  it('allows a valid independent subset after HISTORY is unchecked', async () => {
    state.api.previewInvitation = vi.fn(async () => ({ trainer: { id: 'trainer-public-id' }, purpose: 'training-follow-up', categories: ['HISTORY', 'WEIGHT'], expiresAt: '2027-01-01T00:00:00.000Z', invitationVersion: 9, proposedGrants: [{ kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-02-01T00:00:00.000Z', includeWeight: true }, { kind: 'WEIGHT' }] }))
    await act(async () => { root.render(<InvitationFlow />); await Promise.resolve() })
    await vi.waitFor(() => expect(host.querySelectorAll('input').length).toBe(3))
    await act(async () => { host.querySelectorAll('input')[0].click(); host.querySelectorAll('input')[2].click(); await Promise.resolve() })
    expect(host.querySelector('button.btn:not(.ghost)').disabled).toBe(true)
    await act(async () => { host.querySelectorAll('input')[0].click(); host.querySelectorAll('input')[1].click(); await Promise.resolve() })
    await vi.waitFor(() => expect(host.querySelector('button.btn:not(.ghost)').disabled).toBe(false))
    await act(async () => { host.querySelector('button.btn:not(.ghost)').click(); await Promise.resolve() })
    expect(state.api.acceptInvitation).toHaveBeenCalledWith(expect.objectContaining({ payload: { token, grants: [{ kind: 'WEIGHT' }] } }))
  })

  it('accepts an independently selected optional HISTORY without WEIGHT', async () => {
    state.api.previewInvitation = vi.fn(async () => ({ trainer: { id: 'trainer-public-id' }, purpose: 'training-follow-up', categories: ['HISTORY', 'WEIGHT'], expiresAt: '2027-01-01T00:00:00.000Z', invitationVersion: 9, proposedGrants: [{ kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-02-01T00:00:00.000Z' }, { kind: 'WEIGHT' }] }))
    await act(async () => { root.render(<InvitationFlow />); await Promise.resolve() })
    await vi.waitFor(() => expect(host.querySelectorAll('input').length).toBe(3))
    await act(async () => { host.querySelectorAll('input')[0].click(); host.querySelectorAll('input')[2].click(); await Promise.resolve(); host.querySelector('button.btn:not(.ghost)').click(); await Promise.resolve() })
    expect(state.api.acceptInvitation).toHaveBeenCalledWith(expect.objectContaining({ payload: { token, grants: [{ kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-02-01T00:00:00.000Z' }] } }))
  })

  it('labels a selected HISTORY proposal with its historical body-weight subset', async () => {
    state.api.previewInvitation = vi.fn(async () => ({ trainer: { id: 'trainer-public-id' }, purpose: 'training-follow-up', categories: ['HISTORY', 'WEIGHT'], expiresAt: '2027-01-01T00:00:00.000Z', invitationVersion: 9, proposedGrants: [{ kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-02-01T00:00:00.000Z', includeWeight: true }, { kind: 'WEIGHT' }] }))
    await act(async () => { root.render(<InvitationFlow />); await Promise.resolve() })
    await vi.waitFor(() => expect(host.textContent).toContain('peso corporal histórico'))
  })

  it('keeps the volatile token and operation when a pending receipt omits pendingProposals', async () => {
    await expectPendingReadbackToRemainUncertain([{ relationId, state: 'PENDING_CONFIRMATION', version: 3, grants: [] }])
  })

  it('replays the same acceptance operation after a lost response and clears only after exact active readback', async () => {
    state.api.previewInvitation = vi.fn(async () => ({ trainer: { id: 'trainer-public-id' }, purpose: 'training-follow-up', categories: ['PLAN'], expiresAt: '2027-01-01T00:00:00.000Z', invitationVersion: 9, proposedGrants: [{ kind: 'PLAN' }] }))
    state.api.acceptInvitation = vi.fn(async () => { throw new Error('transport lost') })
    state.api.retry = vi.fn(async operationId => ({ operationId, entity: { type: 'relation', id: relationId, version: 3 }, result: { relationId, state: 'ACTIVE' } }))
    state.api.getClientRelations = vi.fn(async () => ({ relations: [{ relationId, state: 'ACTIVE', version: 3, grants: [{ kind: 'PLAN' }] }] }))
    await act(async () => { root.render(<InvitationFlow />); await Promise.resolve() })
    await vi.waitFor(() => expect(host.querySelectorAll('input').length).toBe(2))
    await act(async () => { host.querySelectorAll('input')[0].click(); host.querySelectorAll('input')[1].click(); [...host.querySelectorAll('button')].find(button => button.textContent.includes('Aceptar')).click(); await Promise.resolve(); await Promise.resolve() })
    await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent.includes('Reintentar la misma operación')).click(); await Promise.resolve(); await Promise.resolve() })
    expect(state.api.retry).toHaveBeenCalledWith(state.api.acceptInvitation.mock.calls[0][0].operationId)
    expect(state.invitation).toBeNull()
  })

  it('accepts only an exact ACTIVE producer relation with matching selected grants and version', () => {
    const receipt = { operationId: crypto.randomUUID(), entity: { type: 'relation', id: relationId, version: 3 }, result: { relationId, state: 'ACTIVE' } }
    const selectedGrants = [{ kind: 'PLAN' }, { kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-02-01T00:00:00.000Z', includeWeight: true }, { kind: 'WEIGHT' }]
    expect(verifyAcceptedInvitationReadback({ receipt, selectedGrants, relations: { relations: [{ relationId, state: 'ACTIVE', version: 3, grants: selectedGrants }] } })).toMatchObject({ relationId, state: 'ACTIVE', version: 3 })
  })

  it('accepts an exact PENDING_CONFIRMATION receipt/readback and selected subset', () => {
    const receipt = { operationId: crypto.randomUUID(), entity: { type: 'relation', id: relationId, version: 3 }, result: { relationId, state: 'PENDING_CONFIRMATION' } }
    const selectedGrants = [{ kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-02-01T00:00:00.000Z', includeWeight: true }, { kind: 'WEIGHT' }]
    expect(verifyAcceptedInvitationReadback({ receipt, selectedGrants, relations: { relations: [{ relationId, state: 'PENDING_CONFIRMATION', version: 3, grants: [], pendingProposals: selectedGrants }] } })).toMatchObject({ relationId, state: 'PENDING_CONFIRMATION', version: 3 })
  })

  it('keeps the volatile token and operation when pending proposals omit a selected grant', async () => {
    await expectPendingReadbackToRemainUncertain([{ relationId, state: 'PENDING_CONFIRMATION', version: 3, grants: [], pendingProposals: [] }])
  })

  it('keeps the volatile token and operation when pending proposals use another relation', async () => {
    await expectPendingReadbackToRemainUncertain([{ relationId: '22222222-2222-4222-8222-222222222222', state: 'PENDING_CONFIRMATION', version: 3, grants: [], pendingProposals: [{ kind: 'PLAN' }] }])
  })

  it('keeps the volatile token and operation when pending proposals have a stale relation version', async () => {
    await expectPendingReadbackToRemainUncertain([{ relationId, state: 'PENDING_CONFIRMATION', version: 2, grants: [], pendingProposals: [{ kind: 'PLAN' }] }])
  })

  it('keeps choices unchecked and sends exact independently selected proposal objects after authentication', async () => {
    await act(async () => { root.render(<InvitationFlow />); await Promise.resolve() })
    await vi.waitFor(() => expect(host.querySelectorAll('input').length).toBe(5))
    expect([...host.querySelectorAll('input')].every(input => !input.checked)).toBe(true)
    await act(async () => { host.querySelectorAll('input').forEach(input => input.click()); await Promise.resolve(); [...host.querySelectorAll('button')].find(button => button.textContent.includes('Aceptar')).click(); await Promise.resolve() })
    expect(state.api.acceptInvitation).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 9, payload: { token, grants: [{ kind: 'PLAN' }, { kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-02-01T00:00:00.000Z' }, { kind: 'HISTORY', startUtc: '2026-03-01T00:00:00.000Z', endExclusiveUtc: '2026-04-01T00:00:00.000Z' }, { kind: 'WEIGHT' }] } }))
    expect(state.api.getClientRelations).toHaveBeenCalledOnce()
  })
})
