// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ManagedOperations, { parseOperationalUsers } from './ManagedOperations.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null })
const users = [{ account: { id: 'server-uid-1' }, roles: ['CLIENT'], version: 4 }]
const mount = async client => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => { root.render(<MemoryRouter><ManagedOperations client={client} access={{ capabilities: ['MANAGE_OPERATIONAL_ROLES'] }} reportHttpError={vi.fn()} /></MemoryRouter>); await Promise.resolve() })
}
const type = async (element, value) => {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  await act(async () => { set.call(element, value); element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' })); await Promise.resolve() })
}

describe('ManagedOperations (unit; controlled transport)', () => {
  it('edits an exact listed UID, sends the closed DTO, then reads back the list', async () => {
    const client = { getAdminUsers: vi.fn(async () => ({ users })), setOperationalRoles: vi.fn(async () => ({ operationId: crypto.randomUUID() })) }
    await mount(client)
    const select = host.querySelector('select')
    await act(async () => { select.value = 'server-uid-1'; select.dispatchEvent(new Event('change', { bubbles: true })); })
    const trainer = [...host.querySelectorAll('input')].find(input => input.parentElement.textContent.includes('TRAINER'))
    await act(async () => { trainer.click() })
    const text = host.querySelector('textarea')
    await type(text, 'cobertura aprobada')
    await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'Guardar roles').click(); await Promise.resolve() })
    expect(client.setOperationalRoles).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 4, payload: { accountId: 'server-uid-1', roles: ['CLIENT', 'TRAINER'], reason: 'cobertura aprobada' } }))
    expect(client.getAdminUsers).toHaveBeenCalledTimes(2)
  })

  it('keeps the edit after a conflict and requires an explicit reload', async () => {
    const client = { getAdminUsers: vi.fn(async () => ({ users })), setOperationalRoles: vi.fn(async () => { throw Object.assign(new Error('conflict'), { status: 409 }) }) }
    await mount(client)
    const select = host.querySelector('select')
    await act(async () => { select.value = 'server-uid-1'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    const text = host.querySelector('textarea')
    await type(text, 'motivo')
    await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'Guardar roles').click(); await Promise.resolve() })
    expect(host.textContent).toContain('Conflicto de versión')
    expect(host.querySelector('textarea').value).toBe('motivo')
    expect(client.getAdminUsers).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed users rather than guessing their identities or versions', () => {
    expect(() => parseOperationalUsers({ users: [{ account: { id: '' }, roles: [], version: 0 }] })).toThrow(/invalid/i)
  })

  it('reads an exact coordinator/client pair and sends its real scope version for removal', async () => {
    const scope = { coordinatorId: 'coord-1', clientId: 'client-1', assigned: true, version: 7 }
    const client = {
      getAdminUsers: vi.fn(async () => ({ users: [
        { account: { id: 'coord-1' }, roles: ['COORDINATOR'], version: 1 },
        { account: { id: 'client-1' }, roles: ['CLIENT'], version: 2 },
      ] })),
      getAdminScopes: vi.fn(async () => ({ scopes: [scope], nextCursor: null, requestId: 'scope-read' })),
      setCoordinatorScope: vi.fn(async () => ({ operationId: crypto.randomUUID() })),
    }
    await mount(client)
    const selects = host.querySelectorAll('select')
    await act(async () => { selects[1].value = 'coord-1'; selects[1].dispatchEvent(new Event('change', { bubbles: true })) })
    await act(async () => { host.querySelectorAll('select')[2].value = 'client-1'; host.querySelectorAll('select')[2].dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() })
    await vi.waitFor(() => expect(client.getAdminScopes).toHaveBeenCalledWith({ coordinatorId: 'coord-1', clientId: 'client-1' }))
    const text = host.querySelector('textarea')
    await type(text, 'retirar cobertura')
    const assign = host.querySelector('[data-scope-assigned]')
    await act(async () => { assign.click(); await Promise.resolve() })
    await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'Guardar ámbito').click(); await Promise.resolve() })
    expect(client.setCoordinatorScope).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 7, payload: { coordinatorId: 'coord-1', clientId: 'client-1', assigned: false, reason: 'retirar cobertura' } }))
  })

  it('keeps a scope edit after conflict and does not reload it implicitly', async () => {
    const client = {
      getAdminUsers: vi.fn(async () => ({ users: [{ account: { id: 'coord-1' }, roles: ['COORDINATOR'], version: 1 }, { account: { id: 'client-1' }, roles: ['CLIENT'], version: 2 }] })),
      getAdminScopes: vi.fn(async () => ({ scopes: [{ coordinatorId: 'coord-1', clientId: 'client-1', assigned: false, version: 0 }], nextCursor: null, requestId: 'scope-read' })),
      setCoordinatorScope: vi.fn(async () => { throw Object.assign(new Error('conflict'), { status: 409 }) }),
    }
    await mount(client)
    const selects = host.querySelectorAll('select')
    await act(async () => { selects[1].value = 'coord-1'; selects[1].dispatchEvent(new Event('change', { bubbles: true })); selects[2].value = 'client-1'; selects[2].dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() })
    await vi.waitFor(() => expect(host.textContent).toContain('Sin asignar'))
    await type(host.querySelector('textarea'), 'probar conflicto')
    await act(async () => { host.querySelector('[data-scope-assigned]').click(); [...host.querySelectorAll('button')].find(button => button.textContent === 'Guardar ámbito').click(); await Promise.resolve() })
    expect(host.textContent).toContain('Conflicto de versión')
    expect(host.querySelector('textarea').value).toBe('probar conflicto')
    expect(client.getAdminScopes).toHaveBeenCalledTimes(1)
  })
})
