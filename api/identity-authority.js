import fs from 'node:fs';

// The legacy account database remains identity authority. This adapter intentionally does not
// trim, fold, or otherwise reinterpret a UID: operational rows must bind the exact existing ID.
export function createIdentityAuthority({ dbPath, getUser } = {}) {
  const lookup = getUser || (uid => {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch { return null; }
    return Array.isArray(parsed?.users) ? parsed.users.find(user => user?.id === uid) || null : null;
  });
  return {
    get(uid) {
      const user = lookup(uid);
      if (!user) return { uid, activity: 'UNKNOWN', active: false };
      if (user.deleted === true) return { uid, activity: 'DELETED', active: false };
      if (user.disabled === true) return { uid, activity: 'DISABLED', active: false };
      return { uid, activity: 'ACTIVE', active: true };
    }
  };
}
