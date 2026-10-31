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
})
