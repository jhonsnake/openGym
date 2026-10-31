// Commercial dates are business-calendar dates in Panama (UTC-05 all year).
const PANAMA_OFFSET_MS = 5 * 60 * 60 * 1000;

export function panamaDateAtServerClock(clock = () => new Date()) {
  return new Date(clock().getTime() - PANAMA_OFFSET_MS).toISOString().slice(0, 10);
}

export function assertPanamaDate(value, name = 'date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError(`${name} must be YYYY-MM-DD`);
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new RangeError(`${name} is not a real calendar date`);
  return { year, month, day, value };
}

export function panamaDayStartUtc(value) {
  const { year, month, day } = assertPanamaDate(value);
  return new Date(Date.UTC(year, month - 1, day, 5)).toISOString();
}

export function nextPanamaDayStartUtc(value) {
  const { year, month, day } = assertPanamaDate(value);
  return new Date(Date.UTC(year, month - 1, day + 1, 5)).toISOString();
}

export function addAnchoredMonths(startPanama, months, anchorDay = assertPanamaDate(startPanama).day) {
  const { year, month } = assertPanamaDate(startPanama);
  if (!Number.isInteger(months) || months < 1 || !Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) throw new TypeError('invalid anchored month period');
  const zeroMonth = month - 1 + months;
  const endYear = year + Math.floor(zeroMonth / 12);
  const endMonth = zeroMonth % 12;
  const last = new Date(Date.UTC(endYear, endMonth + 1, 0)).getUTCDate();
  return `${String(endYear).padStart(4, '0')}-${String(endMonth + 1).padStart(2, '0')}-${String(Math.min(anchorDay, last)).padStart(2, '0')}`;
}

export function periodEndExclusiveUtc({ startPanama, kind, customEndPanamaInclusive, anchorDay }) {
  if (kind === 'CUSTOM') return nextPanamaDayStartUtc(customEndPanamaInclusive);
  const months = { MONTHLY: 1, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 }[kind];
  if (!months) throw new TypeError('invalid period kind');
  const start = assertPanamaDate(startPanama);
  // A clamped interval ends on the first day after month-end (Jan 31 -> Mar 1).
  // Its next interval starts there but keeps day 31 as its anchor (Mar 1 -> Apr 1).
  const exactAnchor = start.day === anchorDay;
  const carriedBoundary = start.day > anchorDay;
  const offset = exactAnchor || carriedBoundary ? months : months - 1;
  const targetMonth = new Date(Date.UTC(start.year, start.month - 1 + offset, 1));
  const last = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate();
  const anchored = `${String(targetMonth.getUTCFullYear()).padStart(4, '0')}-${String(targetMonth.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(anchorDay, last)).padStart(2, '0')}`;
  if (anchorDay > last || !exactAnchor) return nextPanamaDayStartUtc(anchored);
  return panamaDayStartUtc(anchored);
}
