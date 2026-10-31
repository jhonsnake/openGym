import { describe, expect, it, vi } from 'vitest'
import { createAuthorityApi, isUuidV4 } from './authority-api.js'

const id = '123e4567-e89b-42d3-a456-426614174000'
const receipt = (result = { ok: true }) => ({
  operationId: id,
  entity: { type: 'relation', id, version: 3 },
  versionTokens: [{ kind: 'RELATION', key: '["' + id + '"]', version: 3 }],
  result,
  requestId: 'request-1',
})

describe('authority-api', () => {
  it('uses literal routes, POST body for preview, and preserves server errors', async () => {
    const transport = vi.fn(async (path, opts) => {
      expect(path).toBe('/api/invitations/preview')
      expect(opts.method).toBe('POST')
      expect(JSON.parse(opts.body)).toEqual({ token: 'a'.repeat(43) })
      const error = Object.assign(new Error('forbidden'), { status: 403, data: { code: 'forbidden' } })
      throw error
    })
    const client = createAuthorityApi({ transport })
    await expect(client.previewInvitation('a'.repeat(43))).rejects.toMatchObject({ status: 403, data: { code: 'forbidden' } })
  })

  it('clones the mutation attempt and freezes the submitted payload', async () => {
    let submitted
    const transport = vi.fn(async (_path, opts) => {
      submitted = JSON.parse(opts.body)
      return { ...receipt({ echoed: submitted.payload }), operationId: submitted.operationId }
    })
    const client = createAuthorityApi({ transport })
    const payload = { relationId: id, reason: 'keep', nested: { value: 1 } }
    const promise = client.changeRelation('suspend', { expectedVersion: 2, payload })
    payload.reason = 'mutated'
    payload.nested.value = 99
    const result = await promise
    expect(submitted.expectedVersion).toBe(2)
    expect(submitted.payload.reason).toBe('keep')
    expect(submitted.payload.nested.value).toBe(1)
    expect(result.requestId).toBe('request-1')
  })

  it('generates secure v4 IDs and reuses the same tuple only when the caller retries it', async () => {
    const transport = vi.fn(async (_path, opts) => ({ ...receipt(), operationId: JSON.parse(opts.body).operationId }))
    const client = createAuthorityApi({ transport })
    const first = await client.changeRelation('suspend', { expectedVersion: 2, payload: { relationId: id, reason: 'x' } })
    expect(isUuidV4(first.operationId)).toBe(true)
    await expect(client.retry(first.operationId)).rejects.toThrow(/unknown operationId/i)
    expect(transport).toHaveBeenCalledTimes(1)
    expect(JSON.parse(transport.mock.calls[0][1].body).operationId).toBe(first.operationId)
  })

  it('rejects a changed intent before HTTP and preserves the original retry tuple', async () => {
    let fail = true
    const transport = vi.fn(async (_path, opts) => {
      if (fail) { fail = false; throw new Error('timeout') }
      return { ...receipt(), operationId: JSON.parse(opts.body).operationId }
    })
    const client = createAuthorityApi({ transport })
    await expect(client.changeRelation('suspend', { operationId: id, expectedVersion: 2, payload: { relationId: id, reason: 'original' } })).rejects.toThrow('timeout')
    await expect(client.changeRelation('suspend', { operationId: id, expectedVersion: 2, payload: { relationId: id, reason: 'changed' } })).rejects.toThrow(/contradictory/i)
    await expect(client.changeRelation('end', { operationId: id, expectedVersion: 2, payload: { relationId: id, reason: 'original' } })).rejects.toThrow(/contradictory/i)
    await expect(client.changeRelation('suspend', { operationId: id, expectedVersion: 3, payload: { relationId: id, reason: 'original' } })).rejects.toThrow(/contradictory/i)
    expect(transport).toHaveBeenCalledTimes(1)
    await client.retry(id)
    expect(transport).toHaveBeenCalledTimes(2)
    expect(JSON.parse(transport.mock.calls[1][1].body).payload).toEqual({ relationId: id, reason: 'original' })
  })

  it('accepts equivalent payload key ordering and releases attempts on success or clear', async () => {
    const transport = vi.fn(async (_path, opts) => ({ ...receipt(), operationId: JSON.parse(opts.body).operationId }))
    const client = createAuthorityApi({ transport })
    await client.changeRelation('suspend', { operationId: id, expectedVersion: 2, payload: { a: 1, b: { z: 2, y: 3 } } })
    await expect(client.retry(id)).rejects.toThrow(/unknown operationId/i)
    await client.changeRelation('suspend', { operationId: id, expectedVersion: 2, payload: { b: { y: 3, z: 2 }, a: 1 } })
    client.clearAttempts()
    await expect(client.retry(id)).rejects.toThrow(/unknown operationId/i)
  })

  it('requires published entity versions to start at one', async () => {
    const transport = vi.fn(async () => ({ ...receipt(), entity: { ...receipt().entity, version: 0 } }))
    const client = createAuthorityApi({ transport })
    await expect(client.changeRelation('suspend', { expectedVersion: 0, payload: { relationId: id } })).rejects.toThrow(/readback/i)
  })

  it('rejects a malformed mutation readback instead of fabricating versions', async () => {
    const transport = vi.fn(async () => ({ operationId: id, result: {} }))
    const client = createAuthorityApi({ transport })
    await expect(client.changeRelation('suspend', { expectedVersion: 0, payload: { relationId: id, reason: 'x' } }))
      .rejects.toThrow(/readback/i)
  })

  it('does not put invitation tokens in URLs', async () => {
    const transport = vi.fn(async () => ({ trainer: { id: 'trainer' }, purpose: 'training-follow-up', categories: [], expiresAt: '2026-11-01T00:00:00.000Z' }))
    const client = createAuthorityApi({ transport })
    await client.previewInvitation('b'.repeat(43))
    expect(transport.mock.calls[0][0]).toBe('/api/invitations/preview')
  })

  it('reads the trainer invitation queue with only the server-issued opaque cursor', async () => {
    const transport = vi.fn(async () => ({ invitations: [], nextCursor: null, versionTokens: [], requestId: 'queue-1' }))
    const client = createAuthorityApi({ transport })
    await client.getTrainerInvitations({ cursor: 'next opaque cursor' })
    expect(transport).toHaveBeenCalledWith('/api/trainer/invitations?cursor=next%20opaque%20cursor', { method: 'GET' })
  })

  it('keeps required relation IDs on trainer reads and exposes the closed training-session routes', async () => {
    const transport = vi.fn(async (path, opts) => {
      if (opts?.method === 'GET') return { items: [], nextCursor: null, session: null, closeOnlySession: null, versionTokens: [] }
      return { ...receipt(), operationId: JSON.parse(opts.body).operationId }
    })
    const client = createAuthorityApi({ transport })
    await client.getTrainerExecutions({ relationId: id, cursor: 'next page' })
    await client.getTrainerCurrentPlan({ relationId: id })
    await client.getTrainerCurrentGoals({ relationId: id })
    await client.getCurrentSession()
    await client.abandonSession({ expectedVersion: 0, payload: { sessionId: id } })
    await client.publishGoals({ expectedVersion: 0, payload: { relationId: id, goals: [] } })
    expect(transport.mock.calls.map(call => call[0])).toEqual([
      `/api/trainer/executions?relationId=${id}&cursor=next+page`,
      `/api/trainer/plans/current?relationId=${id}`,
      `/api/trainer/goals/current?relationId=${id}`,
      '/api/client/sessions/current',
      '/api/client/sessions/abandon',
      '/api/trainer/goals/publish',
    ])
  })

  it('uses opaque commercial cursors and closed owner export/deletion routes', async () => {
    const transport = vi.fn(async (path, opts) => {
      if (opts?.method === 'GET') return path.startsWith('/api/admin/commercial') ? { clients: [], nextCursor: null } : { schema: 'opengym.owned-export.v1' }
      return { ...receipt({ jobId: id, state: 'READY' }), operationId: JSON.parse(opts.body).operationId }
    })
    const client = createAuthorityApi({ transport })
    await client.getCommercialClients({ cursor: 'opaque client page' })
    await client.requestOwnedExport({ expectedVersion: 2, payload: {} })
    await client.getOwnedExport(id)
    await client.requestDeletion({ expectedVersion: 3, payload: {} })
    expect(transport.mock.calls[0][0]).toBe('/api/admin/commercial/clients?cursor=opaque%20client%20page')
    expect(transport.mock.calls[1][0]).toBe('/api/client/exports')
    expect(JSON.parse(transport.mock.calls[1][1].body).payload).toEqual({})
    expect(transport.mock.calls[2][0]).toBe('/api/client/exports/' + id)
    expect(transport.mock.calls[3][0]).toBe('/api/client/deletion-requests')
  })

  it('uses the closed role and scope routes and paginates only with the server cursor', async () => {
    const transport = vi.fn(async (path, opts) => {
      if (opts?.method === 'GET') return path.startsWith('/api/admin/operations/scopes')
        ? { scopes: [], requestId: 'read-1', nextCursor: null }
        : { users: [], requestId: 'read-1', nextCursor: null }
      return { ...receipt(), operationId: JSON.parse(opts.body).operationId }
    })
    const client = createAuthorityApi({ transport })
    await client.getAdminUsers({ cursor: 'opaque cursor' })
    await client.getAdminScopes({ coordinatorId: 'coord/id', clientId: 'client id', cursor: 'opaque scope cursor' })
    await client.setOperationalRoles({ expectedVersion: 4, payload: { accountId: 'exact-server-id', roles: ['CLIENT', 'TRAINER'], reason: 'revisión' } })
    await client.setCoordinatorScope({ expectedVersion: 0, payload: { coordinatorId: 'coord', clientId: 'client', assigned: true, reason: 'cobertura' } })
    expect(transport.mock.calls[0][0]).toBe('/api/admin/operations/users?cursor=opaque%20cursor')
    expect(transport.mock.calls[1][0]).toBe('/api/admin/operations/scopes?coordinatorId=coord%2Fid&clientId=client+id&cursor=opaque+scope+cursor')
    expect(transport.mock.calls[2][0]).toBe('/api/admin/operations/roles')
    expect(JSON.parse(transport.mock.calls[2][1].body).payload.roles).toEqual(['CLIENT', 'TRAINER'])
    expect(transport.mock.calls[3][0]).toBe('/api/admin/operations/scopes')
  })

  it('rejects malformed scope readback instead of inventing a version', async () => {
    const client = createAuthorityApi({ transport: vi.fn(async () => ({ scopes: [{ coordinatorId: 'coord', clientId: 'client', assigned: true, version: -1 }], nextCursor: null, requestId: 'read' })) })
    await expect(client.getAdminScopes({ coordinatorId: 'coord', clientId: 'client' })).rejects.toThrow(/scope/i)
  })
})
