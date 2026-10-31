import test from 'node:test';
import assert from 'node:assert/strict';
import { CoachError, enqueue, setEntitlementGate } from '../coach/jobs.js';

test('T6 actual Coach queue entrypoint stops a no-longer-entitled user before state/provider work', t => {
  let calls = 0;
  setEntitlementGate(uid => { calls += 1; return uid !== 'expired-client'; });
  t.after(() => setEntitlementGate(() => true));
  assert.throws(() => enqueue('expired-client', { kind: 'review' }), error => error instanceof CoachError && error.code === 'not-entitled');
  assert.equal(calls, 1);
});
