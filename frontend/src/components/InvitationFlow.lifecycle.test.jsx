// @vitest-environment happy-dom
import React, { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const token = 'a'.repeat(43)
const relationId = '11111111-1111-4111-8111-111111111111'
const state = vi.hoisted(() => ({ transport: null, resolveReadback: null, readback: null }))

// The authority client itself remains real.  Only its HTTP seam is replaced so this test exercises
// its actual disposed flag and mutation behaviour under React's StrictMode effect replay.
vi.mock('../lib/api.js', () => ({ api: (...args) => state.transport(...args) }))

const { default: InvitationFlow } = await import('./InvitationFlow.jsx')
const { clearInvitation, currentInvitation, updateInvitation } = await import('../lib/invitation-receiver.js')

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host
let root

const preview = {
  trainer: { id: 'trainer-public-id' },
  purpose: 'training-follow-up',
  categories: ['PLAN', 'EXECUTION'],
  expiresAt: '2027-01-01T00:00:00.000Z',
  invitationVersion: 9,
  proposedGrants: [{ kind: 'PLAN' }, { kind: 'EXECUTION' }],
}

beforeEach(() => {
  clearInvitation()
  globalThis.__opengymInvitation = { token }
  currentInvitation()
  updateInvitation({ preview, selected: [], consent: false })
  state.readback = new Promise(resolve => { state.resolveReadback = resolve })
  state.transport = vi.fn(async (path, opts) => {
    if (path === '/api/invitations/accept') {
      const { operationId, payload } = JSON.parse(opts.body)
      return {
        operationId,
        entity: { type: 'relation', id: relationId, version: 3 },
        versionTokens: [{ kind: 'RELATION', key: '["' + relationId + '"]', version: 3 }],
        requestId: 'accept-request',
        result: { relationId, state: 'PENDING_CONFIRMATION' },
        payload,
      }
    }
    if (path === '/api/client/relations') return state.readback
    throw new Error(`unexpected transport path: ${path}`)
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  clearInvitation()
  delete globalThis.__opengymInvitation
})

describe('InvitationFlow authority-client lifecycle', () => {
  it('recreates the real authority client after StrictMode cleanup before accepting an exact pending proposal subset', async () => {
    await act(async () => { root.render(<StrictMode><InvitationFlow /></StrictMode>); await Promise.resolve() })
    await vi.waitFor(() => expect(host.querySelectorAll('input')).toHaveLength(3))
    await act(async () => {
      host.querySelectorAll('input')[0].click()
      host.querySelectorAll('input')[1].click()
      host.querySelectorAll('input')[2].click()
      host.querySelector('button.btn:not(.ghost)').click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(state.transport).toHaveBeenCalledWith('/api/invitations/accept', expect.objectContaining({ method: 'POST' })))
    const acceptCall = state.transport.mock.calls.find(([path]) => path === '/api/invitations/accept')
    expect(JSON.parse(acceptCall[1].body).payload).toEqual({ token, grants: [{ kind: 'PLAN' }, { kind: 'EXECUTION' }] })
    expect(currentInvitation()).toMatchObject({ consent: true })
    state.resolveReadback({ relations: [{ relationId, state: 'PENDING_CONFIRMATION', version: 3, grants: [], pendingProposals: [{ kind: 'PLAN' }, { kind: 'EXECUTION' }] }] })
    await vi.waitFor(() => expect(currentInvitation()).toBeNull())
    expect(state.transport).toHaveBeenCalledWith('/api/client/relations', { method: 'GET' })
  })
})
