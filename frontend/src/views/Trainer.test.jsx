// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Trainer, { joinTrainerPortfolio, parseTrainerData } from './Trainer.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null })
const invitation = { invitationId: '11111111-1111-4111-8111-111111111111', state: 'PENDING', commercialName: 'Cliente prueba', expiresAt: '2027-01-01T00:00:00.000Z', version: 3 }
const base = () => ({
  getTrainerPortfolio: vi.fn(async () => ({ portfolio: [] })),
  getTrainerRelations: vi.fn(async () => ({ relations: [] })),
  getTrainerInvitations: vi.fn(async () => ({ invitations: [invitation], nextCursor: null, versionTokens: [{ kind: 'INVITE_SET', key: 'x', version: 2 }] })),
  createInvitation: vi.fn(async ({ payload }) => ({ result: { inviteId: '22222222-2222-4222-8222-222222222222', token: 'a'.repeat(43), expiresAt: '2027-01-01T00:00:00.000Z' }, payload })),
  revokeInvitation: vi.fn(async () => ({})),
})
const mount = async (client, access = { capabilities: ['ACCESS_PERSONAL_TRAINING'] }) => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => { root.render(<Trainer client={client} access={access} reportHttpError={vi.fn()} />); await Promise.resolve() })
}
const type = async (element, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  await act(async () => { setter.call(element, value); element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' })); await Promise.resolve() })
}

describe('Trainer (unidad; client controlado, no journey completo)', () => {
  it('lee las tres vistas, muestra cartera vacía y envía DTO cerrado con versión publicada', async () => {
    const client = base(); await mount(client)
    expect(client.getTrainerPortfolio).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('Cartera vacía')
    const inputs = host.querySelectorAll('input')
    await type(inputs[1], 'propósito')
    await act(async () => { host.querySelector('form').requestSubmit(); await Promise.resolve() })
    expect(client.createInvitation).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 2, payload: { commercialName: 'propósito', grants: [{ kind: 'PLAN' }, { kind: 'EXECUTION' }] } }))
    expect(host.textContent).toContain('Enlace de un solo uso')
    expect(host.textContent).not.toContain('a'.repeat(43))
  })

  it('authors an explicit UTC HISTORY range without implicitly selecting current/future WEIGHT', async () => {
    const client = base(); await mount(client)
    expect(host.textContent).toContain('Proponer rango HISTORY')
    expect(host.querySelectorAll('input[type="date"]')).toHaveLength(0)
    await act(async () => { [...host.querySelectorAll('label')].find(label => label.textContent.includes('Proponer rango HISTORY')).querySelector('input').click(); await Promise.resolve() })
    expect(host.textContent).toContain('Inicio incluido (UTC)')
    expect(host.textContent).toContain('Fin exclusivo (UTC)')
    expect(host.textContent).toContain('peso corporal histórico')
    await type([...host.querySelectorAll('label')].find(label => label.textContent.includes('Propósito')).querySelector('input'), 'historial explícito')
    const dates = host.querySelectorAll('input[type="date"]')
    await type(dates[0], '2026-01-01'); await type(dates[1], '2026-02-01')
    await act(async () => { host.querySelector('form').requestSubmit(); await Promise.resolve() })
    expect(client.createInvitation).toHaveBeenCalledWith(expect.objectContaining({ payload: { commercialName: 'historial explícito', grants: [{ kind: 'PLAN' }, { kind: 'EXECUTION' }, { kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-02-01T00:00:00.000Z' }] } }))
  })

  it('joins only exact ACTIVE relation metadata onto an authorized portfolio row', () => {
    const portfolio = [{ relationId: '11111111-1111-4111-8111-111111111111', clientId: 'client-a', state: 'ACTIVE' }, { relationId: '22222222-2222-4222-8222-222222222222', clientId: 'client-b', state: 'ACTIVE' }]
    const relations = [{ relationId: '11111111-1111-4111-8111-111111111111', state: 'ACTIVE', grants: [{ grantId: 'history-a', kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-02-01T00:00:00.000Z' }] }, { relationId: 'foreign-relation', state: 'ACTIVE', grants: [{ grantId: 'weight-foreign', kind: 'WEIGHT' }] }]
    expect(joinTrainerPortfolio(portfolio, relations)).toEqual([{ ...portfolio[0], grants: relations[0].grants }, portfolio[1]])
  })

  it('does not force WEIGHT when historical weight is selected, and refuses the invalid subset before mutation', async () => {
    const client = base(); await mount(client)
    await type([...host.querySelectorAll('label')].find(label => label.textContent.includes('Propósito')).querySelector('input'), 'peso histórico')
    await act(async () => { [...host.querySelectorAll('label')].find(label => label.textContent.includes('Proponer rango HISTORY')).querySelector('input').click(); await Promise.resolve() })
    const dates = host.querySelectorAll('input[type="date"]')
    await type(dates[0], '2026-01-01'); await type(dates[1], '2026-02-01')
    await act(async () => { [...host.querySelectorAll('label')].find(label => label.textContent.includes('Incluir peso corporal histórico')).querySelector('input').click(); host.querySelector('form').requestSubmit(); await Promise.resolve() })
    expect(client.createInvitation).not.toHaveBeenCalled()
    expect(host.textContent).toContain('WEIGHT seleccionado explícitamente')
  })

  it('expone la costura de integración si el wrapper de invitaciones todavía no existe', async () => {
    const client = base(); delete client.getTrainerInvitations; await mount(client)
    expect(host.textContent).toContain('No se pudo cargar la vista')
  })

  it('conserva el formulario ante conflicto y no inventa identidades', async () => {
    const client = base(); client.createInvitation = vi.fn(async () => { throw Object.assign(new Error('conflict'), { status: 409 }) }); await mount(client)
    const inputs = host.querySelectorAll('input')
    await type(inputs[1], 'intención')
    await act(async () => { host.querySelector('form').requestSubmit(); await Promise.resolve() })
    expect(host.textContent).toContain('Conflicto de versión')
    expect(host.querySelectorAll('input')[1].value).toBe('intención')
    expect(() => parseTrainerData({ portfolio: {}, relations: { relations: [] }, invitations: { invitations: [] } })).toThrow(/portfolio/i)
  })

  it('conserva la primera página al leer la siguiente cola opaca de invitaciones', async () => {
    const client = base()
    client.getTrainerInvitations = vi.fn()
      .mockResolvedValueOnce({ invitations: [invitation], nextCursor: 'opaque-next', versionTokens: [{ kind: 'INVITE_SET', key: 'x', version: 2 }] })
      .mockResolvedValueOnce({ invitations: [{ ...invitation, invitationId: '22222222-2222-4222-8222-222222222222', commercialName: 'Cliente siguiente' }], nextCursor: null, versionTokens: [{ kind: 'INVITE_SET', key: 'x', version: 2 }] })
    await mount(client)
    await act(async () => { [...host.querySelectorAll('button')].find(item => item.textContent === 'Cargar más invitaciones').click(); await Promise.resolve() })
    expect(host.textContent).toContain('Cliente prueba')
    expect(host.textContent).toContain('Cliente siguiente')
    expect(client.getTrainerInvitations).toHaveBeenLastCalledWith({ cursor: 'opaque-next' })
  })
})
