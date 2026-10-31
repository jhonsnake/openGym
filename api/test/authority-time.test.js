import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuthorityStore } from '../authority-store.js';
import { createAuthorityService } from '../authority-service.js';
import { panamaDayStartUtc, periodEndExclusiveUtc } from '../subscription-calendar.js';

const op = n => `123e4567-e89b-42d3-a456-426614174${String(n).padStart(3, '0')}`;
const stamp = '2027-01-31T12:00:00.000Z';
function setup() {
  const store = createAuthorityStore({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'authority-time-')) });
  const identities = new Set(['admin', 'coordinator', 'client', 'other']);
  const service = createAuthorityService({ store, clock: () => stamp, identity: { get: uid => ({ uid, active: identities.has(uid), activity: identities.has(uid) ? 'ACTIVE' : 'UNKNOWN' }) }, isAdmin: uid => uid === 'admin' });
  service.setRoles({ actorId: 'admin', operationId: op(1), expectedVersion: 0, payload: { accountId: 'coordinator', roles: ['COORDINATOR'], reason: 'commercial desk' } });
  service.setRoles({ actorId: 'admin', operationId: op(2), expectedVersion: 0, payload: { accountId: 'client', roles: ['CLIENT'], reason: 'client account' } });
  service.setScope({ actorId: 'admin', operationId: op(3), expectedVersion: 0, payload: { coordinatorId: 'coordinator', clientId: 'client', assigned: true, reason: 'assigned account' } });
  return { store, service };
}

function addMonths(year, month, months) {
  const zeroMonth = month - 1 + months;
  return { year: year + Math.floor(zeroMonth / 12), month: (zeroMonth % 12) + 1 };
}

function lastDay(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function nextDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function independentExpectedEnd(startPanama, months, anchorDay) {
  const [year, month, day] = startPanama.split('-').map(Number);
  const carriedBoundary = day > anchorDay;
  const target = addMonths(year, month, day === anchorDay || carriedBoundary ? months : months - 1);
  const anchoredDay = Math.min(anchorDay, lastDay(target.year, target.month));
  const endDate = carriedBoundary || day !== anchorDay || anchorDay > lastDay(target.year, target.month)
    ? nextDate(target.year, target.month, anchoredDay)
    : { ...target, day: anchoredDay };
  return `${String(endDate.year).padStart(4, '0')}-${String(endDate.month).padStart(2, '0')}-${String(endDate.day).padStart(2, '0')}T05:00:00.000Z`;
}

function panamaDateFromUtc(utc) {
  return new Date(Date.parse(utc) - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dateParts(value) {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

test('Panama month anchors preserve the literal end-of-month cases and valid leap/custom dates', () => {
  assert.equal(periodEndExclusiveUtc({ startPanama: '2027-01-31', kind: 'MONTHLY', anchorDay: 31 }), '2027-03-01T05:00:00.000Z');
  assert.equal(periodEndExclusiveUtc({ startPanama: '2027-03-01', kind: 'MONTHLY', anchorDay: 31 }), '2027-04-01T05:00:00.000Z');
  assert.equal(periodEndExclusiveUtc({ startPanama: '2028-02-29', kind: 'MONTHLY', anchorDay: 29 }), '2028-03-29T05:00:00.000Z');
  assert.equal(periodEndExclusiveUtc({ startPanama: '2028-02-28', kind: 'CUSTOM', customEndPanamaInclusive: '2028-02-29' }), '2028-03-01T05:00:00.000Z');
});

test('clamped monthly renewals advance from the persisted exclusive boundary', () => {
  assert.equal(periodEndExclusiveUtc({ startPanama: '2027-01-30', kind: 'MONTHLY', anchorDay: 30 }), '2027-03-01T05:00:00.000Z');
  assert.equal(periodEndExclusiveUtc({ startPanama: '2027-03-01', kind: 'MONTHLY', anchorDay: 30 }), '2027-03-31T05:00:00.000Z');
  assert.equal(periodEndExclusiveUtc({ startPanama: '2027-03-31', kind: 'MONTHLY', anchorDay: 30 }), '2027-05-01T05:00:00.000Z');
  assert.equal(periodEndExclusiveUtc({ startPanama: '2027-01-29', kind: 'MONTHLY', anchorDay: 29 }), '2027-03-01T05:00:00.000Z');
  assert.equal(periodEndExclusiveUtc({ startPanama: '2027-03-01', kind: 'MONTHLY', anchorDay: 29 }), '2027-03-30T05:00:00.000Z');
  assert.equal(periodEndExclusiveUtc({ startPanama: '2027-03-30', kind: 'MONTHLY', anchorDay: 29 }), '2027-04-30T05:00:00.000Z');
});

test('invalid calendar dates remain rejected', () => {
  assert.throws(() => periodEndExclusiveUtc({ startPanama: '2027-02-29', kind: 'MONTHLY', anchorDay: 29 }), /real calendar date/);
  assert.throws(() => periodEndExclusiveUtc({ startPanama: '2028-02-30', kind: 'MONTHLY', anchorDay: 30 }), /real calendar date/);
  assert.throws(() => periodEndExclusiveUtc({ startPanama: '2027-01-01', kind: 'CUSTOM', customEndPanamaInclusive: '2027-02-29' }), /real calendar date/);
});

test('all valid calendar starts keep strict progress and their original anchor', () => {
  const kinds = [['MONTHLY', 1], ['QUARTERLY', 3], ['SEMIANNUAL', 6], ['ANNUAL', 12]];
  for (const year of [2027, 2028, 2031]) {
    for (let month = 1; month <= 12; month += 1) {
      for (let day = 1; day <= lastDay(year, month); day += 1) {
        const start = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        for (const [kind, months] of kinds) {
          let boundary = panamaDayStartUtc(start);
          for (let renewal = 0; renewal < 8; renewal += 1) {
            const phaseStart = panamaDateFromUtc(boundary);
            const actual = periodEndExclusiveUtc({ startPanama: phaseStart, kind, anchorDay: day });
            const expected = independentExpectedEnd(phaseStart, months, day);
            assert.equal(actual, expected, `${kind} ${start} renewal ${renewal}`);
            assert.ok(Date.parse(actual) > Date.parse(boundary), `${kind} ${start} renewal ${renewal} stalled`);
            assert.equal(day, dateParts(start).day, `${kind} ${start} anchor changed`);
            boundary = actual;
          }
        }
      }
    }
  }
});

test('scoped coordinator persists one commercial interval, replay is harmless, stale new intent conflicts', () => {
  const { store, service } = setup();
  const body = { operationId: op(10), expectedVersion: 0, payload: { clientId: 'client', kind: 'MONTHLY', reference: 'external receipt', reason: 'manual confirmation' } };
  const first = service.confirmCommercialOperation({ actorId: 'coordinator', body, requestId: 'r1' });
  assert.equal(first.result.interval.startUtc, '2027-01-31T05:00:00.000Z');
  assert.equal(first.result.interval.endExclusiveUtc, '2027-03-01T05:00:00.000Z');
  assert.equal(service.confirmCommercialOperation({ actorId: 'coordinator', body, requestId: 'r2' }).replayed, true);
  assert.throws(() => service.confirmCommercialOperation({ actorId: 'coordinator', body: { ...body, operationId: op(11) }, requestId: 'r3' }), /conflict/);
  assert.equal(store.db.prepare('SELECT count(*) n FROM subscription_intervals').get().n, 1);
  assert.throws(() => service.confirmCommercialOperation({ actorId: 'admin', body: { ...body, operationId: op(12), expectedVersion: 1 }, requestId: 'r4' }), /forbidden/);
});
