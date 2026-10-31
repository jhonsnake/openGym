// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ClientConsent from './ClientConsent.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const relationId = '11111111-1111-4111-8111-111111111111'
let host, root
afterEach(() => { act(() => root?.unmount()); host?.remove() })
describe('ClientConsent', () => {
  it('is available without a personal entitlement and withdraws an explicit grant using the server relation version', async () => {
    const client = { getClientRelations: vi.fn(async () => ({ relations: [{ relationId, state: 'ACTIVE', grants: [{ kind: 'PLAN' }, { kind: 'WEIGHT' }], version: 4 }], nextCursor: null, versionTokens: [], requestId: 'read' })), revokeGrant: vi.fn(async () => ({ result: {} })), replaceGrants: vi.fn(), revokeRelation: vi.fn(), acceptRelationReactivation: vi.fn(), retry: vi.fn() }
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => { root.render(<ClientConsent client={client} access={{ account: { id: 'client', activity: 'ACTIVE' }, entitlement: { active: false } }} reportHttpError={vi.fn()} />); await Promise.resolve(); await Promise.resolve() })
    expect(host.textContent).toContain('Relación ' + relationId)
    await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'Retirar PLAN').click(); await Promise.resolve() })
    expect(client.revokeGrant).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 4, payload: { relationId, kind: 'PLAN', reason: 'Retiro explícito desde mi espacio de consentimiento' } }))
  })

  it('discloses historical body-weight in an existing HISTORY grant', async () => {
    const client = { getClientRelations: vi.fn(async () => ({ relations: [{ relationId, state: 'ACTIVE', grants: [{ kind: 'PLAN' }, { kind: 'WEIGHT' }, { kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-02-01T00:00:00.000Z', includeWeight: true }], version: 4 }], nextCursor: null })), revokeGrant: vi.fn(), replaceGrants: vi.fn(), revokeRelation: vi.fn(), acceptRelationReactivation: vi.fn(), retry: vi.fn() }
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => { root.render(<ClientConsent client={client} access={{ account: { activity: 'ACTIVE' } }} />); await Promise.resolve(); await Promise.resolve() })
    expect(host.textContent).toContain('incluye peso corporal histórico')
  })

  it('authors a new ranged HISTORY grant while preserving existing ranges and requiring a separate WEIGHT choice', async () => {
    const existing = { kind: 'HISTORY', startUtc: '2025-01-01T00:00:00.000Z', endExclusiveUtc: '2025-02-01T00:00:00.000Z' }
    const client = { getClientRelations: vi.fn(async () => ({ relations: [{ relationId, state: 'ACTIVE', grants: [{ kind: 'PLAN' }, { kind: 'WEIGHT' }, existing], version: 4 }], nextCursor: null })), revokeGrant: vi.fn(), replaceGrants: vi.fn(async () => ({})), revokeRelation: vi.fn(), acceptRelationReactivation: vi.fn(), retry: vi.fn() }
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => { root.render(<ClientConsent client={client} access={{ account: { activity: 'ACTIVE' } }} />); await Promise.resolve(); await Promise.resolve() })
    expect(host.textContent).toContain('Añadir HISTORY')
    expect(host.querySelectorAll('input[type="date"]')).toHaveLength(0)
    await act(async () => { [...host.querySelectorAll('label')].find(label => label.textContent.includes('Añadir HISTORY')).querySelector('input').click(); await Promise.resolve() })
    const dates = host.querySelectorAll('input[type="date"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    await act(async () => { setter.call(dates[0], '2026-03-01'); dates[0].dispatchEvent(new Event('input', { bubbles: true })); setter.call(dates[1], '2026-04-01'); dates[1].dispatchEvent(new Event('input', { bubbles: true })); await Promise.resolve() })
    await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'Guardar nuevo rango HISTORY').click(); await Promise.resolve() })
    expect(client.replaceGrants).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 4, payload: { relationId, grants: [{ kind: 'PLAN' }, { kind: 'WEIGHT' }, existing, { kind: 'HISTORY', startUtc: '2026-03-01T00:00:00.000Z', endExclusiveUtc: '2026-04-01T00:00:00.000Z' }] } }))
  })
})
