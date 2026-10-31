// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Commercial, { parseCommercialReadback } from './Commercial.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null })
const clientRow = { clientId: 'cliente-ñ/legacy', entitlement: { active: false, startUtc: null, endExclusiveUtc: null, version: 7 } }
const interval = { startUtc: '2027-01-01T05:00:00.000Z', endExclusiveUtc: '2027-02-01T05:00:00.000Z' }
const renewedRow = { clientId: clientRow.clientId, entitlement: { active: false, ...interval, version: 8 } }
const readback = (clients, nextCursor = null) => ({ clients, nextCursor, versionTokens: clients.map(row => ({ kind: 'SUBSCRIPTION', key: JSON.stringify([row.clientId]), version: row.entitlement.version })), requestId: 'commercial-readback' })
const receipt = ({ operationId = '123e4567-e89b-42d3-a456-426614174000', clientId = clientRow.clientId, resultInterval = interval, active = false, version = 8 } = {}) => ({ operationId, entity: { type: 'subscription', id: clientId, version }, versionTokens: [{ kind: 'SUBSCRIPTION', key: JSON.stringify([clientId]), version }], result: { clientId, interval: resultInterval, entitlement: { active, ...resultInterval } }, requestId: 'commercial-receipt' })
const base = () => ({ getCommercialClients: vi.fn().mockResolvedValueOnce(readback([clientRow])).mockResolvedValue(readback([renewedRow])), confirmCommercialOperation: vi.fn(async ({ operationId }) => receipt({ operationId })), retry: vi.fn() })
const mount = async (client, access = { roles: ['COORDINATOR'] }) => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => { root.render(<Commercial client={client} access={access} reportHttpError={vi.fn()} />); await Promise.resolve() }) }
const type = async (element, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; await act(async () => { setter.call(element, value); element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' })); await Promise.resolve() }) }
const fill = async () => { const inputs = host.querySelectorAll('input'); await type(inputs[0], 'registro externo'); await type(inputs[1], 'razón operativa'); await act(async () => { host.querySelector('input[type="checkbox"]').click(); await Promise.resolve() }) }

describe('Commercial (unidad; transporte controlado, no integración App)', () => {
  it('deniega TRAINER aunque tenga capacidades y permite COORDINATOR sin CLIENT', async () => { const client = base(); await mount(client, { roles: ['TRAINER'], capabilities: ['ACCESS_PERSONAL_TRAINING'] }); expect(client.getCommercialClients).not.toHaveBeenCalled(); expect(host.textContent).toContain('COORDINATOR'); await act(async () => { root.unmount(); host.remove(); host = null; root = null }); await mount(client, { roles: ['COORDINATOR'], capabilities: [] }); expect(client.getCommercialClients).toHaveBeenCalled() })
  it('envía campos editados, versión publicada y omite fechas no CUSTOM', async () => { const client = base(); await mount(client); await act(async () => { host.querySelector('select').value = clientRow.clientId; host.querySelector('select').dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() }); await fill(); await act(async () => { host.querySelector('form').requestSubmit(); await Promise.resolve() }); expect(client.confirmCommercialOperation).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 7, payload: { clientId: clientRow.clientId, kind: 'MONTHLY', reference: 'registro externo', reason: 'razón operativa' }, operationId: expect.stringMatching(/-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-/i) }))
  })
  it('conserva filas paginadas, usa fechas CUSTOM inclusivas y distingue futura', async () => { const client = base(); client.getCommercialClients = vi.fn().mockResolvedValueOnce(readback([clientRow], 'opaque')).mockResolvedValueOnce(readback([{ ...clientRow, clientId: 'segundo' }])); await mount(client); await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent.includes('Cargar más')).click(); await Promise.resolve() }); expect(host.textContent).toContain('cliente-ñ/legacy'); expect(host.textContent).toContain('segundo'); expect(client.getCommercialClients).toHaveBeenLastCalledWith({ cursor: 'opaque' }); expect(() => parseCommercialReadback({ clients: {} })).toThrow(/commercial/i) })
  it('does not mark an operation confirmed when its post-mutation authority read fails', async () => {
    const client = base()
    const error = Object.assign(new Error('read lost'), { status: 0 })
    client.getCommercialClients = vi.fn().mockResolvedValueOnce(readback([clientRow])).mockRejectedValueOnce(error)
    await mount(client)
    await act(async () => { const select = host.querySelector('select'); select.value = clientRow.clientId; select.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() })
    await fill()
    await act(async () => { host.querySelector('form').requestSubmit(); await Promise.resolve() })
    expect(host.textContent).not.toContain('Operación confirmada por el servidor.')
    expect(host.textContent).toContain('Resultado incierto')
    expect(host.textContent).toContain('Reintentar misma operación')
  })
  it('does not confirm when the receipt identifies another client', async () => {
    const client = base()
    client.confirmCommercialOperation = vi.fn(async ({ operationId }) => receipt({ operationId, clientId: 'otro-cliente' }))
    await mount(client)
    await act(async () => { const select = host.querySelector('select'); select.value = clientRow.clientId; select.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() })
    await fill()
    await act(async () => { host.querySelector('form').requestSubmit(); await Promise.resolve() })
    expect(host.textContent).not.toContain('Operación confirmada por el servidor.')
    expect(host.textContent).toContain('Resultado incierto')
  })
  it('does not confirm when the persisted interval differs from the receipt', async () => {
    const client = base()
    const otherInterval = { startUtc: '2027-02-01T05:00:00.000Z', endExclusiveUtc: '2027-03-01T05:00:00.000Z' }
    client.getCommercialClients = vi.fn().mockResolvedValueOnce(readback([clientRow])).mockResolvedValueOnce(readback([{ clientId: clientRow.clientId, entitlement: { active: false, ...otherInterval, version: 8 } }]))
    await mount(client)
    await act(async () => { const select = host.querySelector('select'); select.value = clientRow.clientId; select.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() })
    await fill()
    await act(async () => { host.querySelector('form').requestSubmit(); await Promise.resolve() })
    expect(host.textContent).not.toContain('Operación confirmada por el servidor.')
    expect(host.textContent).toContain('Resultado incierto')
  })
  it('does not confirm when the matching interval has not advanced to the receipt aggregate version', async () => {
    const client = base()
    client.getCommercialClients = vi.fn().mockResolvedValueOnce(readback([clientRow])).mockResolvedValueOnce(readback([{ clientId: clientRow.clientId, entitlement: { active: false, ...interval, version: 7 } }]))
    await mount(client)
    await act(async () => { const select = host.querySelector('select'); select.value = clientRow.clientId; select.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() })
    await fill()
    await act(async () => { host.querySelector('form').requestSubmit(); await Promise.resolve() })
    expect(host.textContent).not.toContain('Operación confirmada por el servidor.')
    expect(host.textContent).toContain('Resultado incierto')
  })
  it('does not confirm when the persisted entitlement state differs from the receipt', async () => {
    const client = base()
    client.getCommercialClients = vi.fn().mockResolvedValueOnce(readback([clientRow])).mockResolvedValueOnce(readback([{ clientId: clientRow.clientId, entitlement: { active: true, ...interval, version: 8 } }]))
    await mount(client)
    await act(async () => { const select = host.querySelector('select'); select.value = clientRow.clientId; select.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() })
    await fill()
    await act(async () => { host.querySelector('form').requestSubmit(); await Promise.resolve() })
    expect(host.textContent).not.toContain('Operación confirmada por el servidor.')
    expect(host.textContent).toContain('Resultado incierto')
  })
  it('confirms only a renewal whose client, interval, state, and aggregate version match', async () => {
    const client = base()
    await mount(client)
    await act(async () => { const select = host.querySelector('select'); select.value = clientRow.clientId; select.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() })
    await fill()
    await act(async () => { host.querySelector('form').requestSubmit(); await Promise.resolve() })
    expect(host.textContent).toContain('Operación confirmada por el servidor.')
    expect(host.textContent).toContain('Recibo confirmado')
    expect(host.textContent).toContain('versión 8')
  })
  it('does not commit an old client mutation after the commercial client changes', async () => {
    const client = base()
    let resolveMutation
    client.confirmCommercialOperation = vi.fn(() => new Promise(resolve => { resolveMutation = resolve }))
    await mount(client)
    await act(async () => { const select = host.querySelector('select'); select.value = clientRow.clientId; select.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() })
    await fill()
    await act(async () => { host.querySelector('form').requestSubmit(); await Promise.resolve() })
    const replacement = base()
    await act(async () => { root.render(<Commercial client={replacement} access={{ roles: ['COORDINATOR'] }} reportHttpError={vi.fn()} />); await Promise.resolve() })
    await act(async () => { resolveMutation(receipt()); await Promise.resolve() })
    expect(host.textContent).not.toContain('Operación confirmada por el servidor.')
    expect(host.textContent).not.toContain('Recibo confirmado')
    expect(replacement.getCommercialClients).toHaveBeenCalled()
  })
  it('keeps the immutable intent for a lost reply replay and confirms only its matching renewal', async () => { const client = base(); const error = Object.assign(new Error('network'), { status: 0 }); client.confirmCommercialOperation = vi.fn().mockRejectedValueOnce(error).mockImplementationOnce(async ({ operationId }) => receipt({ operationId })); await mount(client); await act(async () => { const select = host.querySelector('select'); select.value = clientRow.clientId; select.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() }); await fill(); await act(async () => { host.querySelector('form').requestSubmit(); await Promise.resolve() }); const intent = client.confirmCommercialOperation.mock.calls[0][0]; await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent.includes('Reintentar misma')).click(); await Promise.resolve() }); expect(client.confirmCommercialOperation.mock.calls[1][0]).toEqual(intent); expect(host.textContent).toContain('Operación confirmada por el servidor.') })
})
