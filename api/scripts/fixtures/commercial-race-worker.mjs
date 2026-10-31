import { createAuthorityStore } from '../../authority-store.js';
import { createAuthorityService } from '../../authority-service.js';

const identities = new Set(['admin', 'coordinator', 'client']);
const store = createAuthorityStore({ dataDir: process.env.AUTHORITY_RACE_DATA_DIR });
const service = createAuthorityService({
  store,
  clock: () => '2027-01-31T12:00:00.000Z',
  identity: { get: uid => ({ uid, active: identities.has(uid), activity: identities.has(uid) ? 'ACTIVE' : 'UNKNOWN' }) },
  isAdmin: uid => uid === 'admin'
});

process.send?.({ type: 'ready' });
process.once('message', message => {
  if (message?.type !== 'mutate') return;
  let result;
  try {
    const receipt = service.confirmCommercialOperation({ actorId: 'coordinator', body: message.body, requestId: message.requestId });
    result = { type: 'result', status: 200, receipt };
  } catch (error) {
    result = { type: 'result', status: error.code === 'conflict' ? 409 : 500, code: error.code };
  } finally {
    store.close();
    process.send?.(result);
  }
});
