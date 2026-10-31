const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function utcMidnight(date, label) {
  const match = DATE.exec(date || '')
  if (!match) throw new Error(`${label} debe ser una fecha UTC válida.`)
  const [year, month, day] = match.slice(1).map(Number)
  const value = new Date(Date.UTC(year, month - 1, day))
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) throw new Error(`${label} debe ser una fecha UTC válida.`)
  return value.toISOString()
}

export function historyGrantFromDraft({ startDate, endDate, includeWeight = false } = {}) {
  const startUtc = utcMidnight(startDate, 'El inicio')
  const endExclusiveUtc = utcMidnight(endDate, 'El fin exclusivo')
  if (startUtc >= endExclusiveUtc) throw new Error('El inicio incluido debe ser anterior al fin exclusivo.')
  return { kind: 'HISTORY', startUtc, endExclusiveUtc, ...(includeWeight === true ? { includeWeight: true } : {}) }
}

export function formatGrant(grant) {
  if (grant?.kind === 'HISTORY') return `HISTORY: ${grant.startUtc} (inicio incluido) a ${grant.endExclusiveUtc} (fin exclusivo), UTC${grant.includeWeight === true ? '; incluye peso corporal histórico' : ''}`
  if (grant?.kind === 'WEIGHT') return 'WEIGHT: peso corporal actual y futuro'
  if (grant?.kind === 'PLAN') return 'PLAN (incluye metas)'
  return grant?.kind || ''
}

export function hasExactGrantSubset(grants, selected) {
  const actual = Array.isArray(grants) ? grants : []
  return (Array.isArray(selected) ? selected : []).every(choice => actual.some(grant => grant?.kind === choice?.kind
    && (grant.startUtc ?? null) === (choice.startUtc ?? null)
    && (grant.endExclusiveUtc ?? null) === (choice.endExclusiveUtc ?? null)
    && (grant.includeWeight === true) === (choice.includeWeight === true)))
}

export function HistoryGrantEditor({ draft, onChange, disabled = false, legend = 'HISTORY', selectionLabel = 'Proponer rango HISTORY' }) {
  const value = draft || { enabled: false, startDate: '', endDate: '', includeWeight: false }
  const update = patch => onChange?.({ ...value, ...patch })
  return <fieldset data-history-grant-editor="true">
    <legend>{legend}</legend>
    <label><input type="checkbox" checked={value.enabled === true} disabled={disabled} onChange={event => update({ enabled: event.target.checked })} /> {selectionLabel}</label>
    {value.enabled === true && <><p className="muted">Rango en UTC: el inicio está incluido y el fin es exclusivo.</p>
      <label>Inicio incluido (UTC)<input type="date" value={value.startDate || ''} disabled={disabled} onChange={event => update({ startDate: event.target.value })} /></label>
      <label>Fin exclusivo (UTC)<input type="date" value={value.endDate || ''} disabled={disabled} onChange={event => update({ endDate: event.target.value })} /></label>
      <label><input type="checkbox" checked={value.includeWeight === true} disabled={disabled} onChange={event => update({ includeWeight: event.target.checked })} /> Incluir peso corporal histórico únicamente en este rango</label></>}
  </fieldset>
}
