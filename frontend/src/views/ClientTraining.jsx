import { useEffect, useMemo, useRef, useState } from 'react'
import { EXIDX } from '../lib/exercises.js'
import { createClientTrainingDraftStore } from '../lib/client-training-draft.js'

const token = (tokens, kind) => Array.isArray(tokens) ? tokens.find(item => item?.kind === kind && Number.isSafeInteger(item.version) && item.version >= 0) || null : null
const uuid = () => {
  const value = globalThis.crypto?.randomUUID?.()
  if (typeof value !== 'string') throw new Error('No se pudo crear un identificador seguro para esta operación.')
  return value
}
const ownAccess = access => !!(access?.account?.id && access.account.activity === 'ACTIVE' && access.roles?.includes('CLIENT') && access.entitlement?.active === true && access.capabilities?.includes('ACCESS_PERSONAL_TRAINING') && access.compatibility?.protectedTraining === 'supported' && typeof access.requestId === 'string' && access.requestId)
const snapshotExercise = entry => ({ planEntryId: entry.entryId, exerciseId: entry.exerciseId, disposition: 'PERFORMED', substituteId: '', sets: [] })
const blankSet = mode => ({ phase: 'work', completed: true, [mode === 'time' ? 'seconds' : 'reps']: '', loadKind: 'none', kg: '', effortKind: '', effortValue: '', failure: false })
const nameOf = (id, entry) => EXIDX[id]?.n || entry?.exerciseName || entry?.name || id
const targetText = (target, mode) => {
  if (!target) return 'Sin objetivo publicado'
  if (mode === 'time') return `${target.seconds} s`
  const reps = target.reps?.exact ?? (target.reps ? `${target.reps.min}–${target.reps.max}` : '–')
  const load = target.load?.kind === 'BODY_WEIGHT' ? 'peso corporal' : target.load?.kind ? `${target.load.kind.toLowerCase()} ${target.load.kg} kg` : ''
  const effort = target.effort ? `${target.effort.kind} ${target.effort.value}` : ''
  return [reps + ' repeticiones', load, effort].filter(Boolean).join(' · ')
}
const targetAt = (entry, index) => entry?.setOverrides?.[String(index)] || entry?.commonTarget
const actualSetText = set => [set.phase === 'warmup' ? 'calentamiento' : 'trabajo', set.reps !== undefined ? `${set.reps} repeticiones` : set.seconds !== undefined ? `${set.seconds} s` : 'sin cantidad', set.load?.kind === 'BODY_WEIGHT' ? 'peso corporal' : set.load?.kind ? `${set.load.kind.toLowerCase()} ${set.load.kg} kg` : '', set.effort ? `${set.effort.kind} ${set.effort.value}` : '', set.completed === false ? 'no completado' : set.completed ? 'completado' : '', set.failure ? 'fallo' : ''].filter(Boolean).join(' · ')
const goalText = goal => goal.kind === 'CONSISTENCY' ? `${goal.targetSessionsPerWeek} sesiones/semana` : goal.kind === 'BODY_WEIGHT' ? `${goal.targetWeight} ${goal.unit}` : `${nameOf(goal.exerciseId, goal)} · ${goal.targetLoad?.kind === 'BODY_WEIGHT' ? 'peso corporal' : `${goal.targetLoad?.kind?.toLowerCase()} ${goal.targetLoad?.kg} kg`} · ${goal.targetReps} repeticiones`
const onlineNow = () => typeof navigator === 'undefined' || navigator.onLine !== false
const panamaDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number); const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}
const requiredNumber = value => (typeof value === 'string' && value.trim() === '') || value === null || value === undefined ? Number.NaN : Number(value)

function validateEntries(snapshot, actual) {
  const entries = []
  for (const prescribed of snapshot.exercises || []) {
    const row = actual.entries?.[prescribed.entryId]
    if (!row) return { error: 'Cada fila prescrita debe declararse exactamente una vez.' }
    if (row.disposition === 'OMITTED') { entries.push({ planEntryId: prescribed.entryId, exerciseId: prescribed.exerciseId, disposition: 'OMITTED', sets: [] }); continue }
    const exerciseId = row.disposition === 'SUBSTITUTED' ? String(row.substituteId || '').trim() : prescribed.exerciseId
    if (row.disposition === 'SUBSTITUTED' && (!EXIDX[exerciseId] || exerciseId === prescribed.exerciseId)) return { error: 'La sustitución debe usar un ejercicio reconocido y diferente.' }
    if (!Array.isArray(row.sets) || row.sets.length < 1) return { error: `Añade al menos un set real para ${nameOf(prescribed.exerciseId, prescribed)} o márcalo omitido.` }
    const sets = []
    for (const source of row.sets) {
      const amount = Number(source[prescribed.mode === 'time' ? 'seconds' : 'reps'])
      const max = prescribed.mode === 'time' ? 21600 : 1000
      if (!Number.isInteger(amount) || amount < 1 || amount > max) return { error: prescribed.mode === 'time' ? 'Cada tiempo real debe ser de 1 a 21600 segundos.' : 'Cada repetición real debe ser un entero de 1 a 1000.' }
      const set = { phase: source.phase === 'warmup' ? 'warmup' : 'work', completed: !!source.completed, [prescribed.mode === 'time' ? 'seconds' : 'reps']: amount }
      if (source.loadKind && source.loadKind !== 'none') {
        if (source.loadKind === 'BODY_WEIGHT') set.load = { kind: 'BODY_WEIGHT' }
        else {
          const kg = requiredNumber(source.kg)
          if (!['EXTERNAL', 'ASSISTANCE'].includes(source.loadKind) || !Number.isFinite(kg) || kg < 0 || kg > 2000) return { error: 'La carga real debe ser peso corporal o una carga válida de 0 a 2000 kg.' }
          set.load = { kind: source.loadKind, kg }
        }
      }
      if (set.phase === 'work' && source.effortKind) {
        const value = requiredNumber(source.effortValue); const min = source.effortKind === 'RPE' ? 6 : 0
        if (!['RPE', 'RIR'].includes(source.effortKind) || !Number.isFinite(value) || value < min || value > 10 || Math.round(value * 2) !== value * 2) return { error: 'RPE/RIR debe estar dentro de su rango en pasos de 0,5.' }
        set.effort = { kind: source.effortKind, value }
      }
      if (set.phase === 'work' && source.failure) set.failure = true
      sets.push(set)
    }
    entries.push({ planEntryId: prescribed.entryId, exerciseId, disposition: row.disposition === 'SUBSTITUTED' ? 'SUBSTITUTED' : 'PERFORMED', sets })
  }
  for (const extra of actual.extras || []) {
    const exerciseId = String(extra.exerciseId || '').trim()
    if (!EXIDX[exerciseId]) return { error: 'Cada ejercicio añadido debe ser un ID reconocido del catálogo.' }
    if (!Array.isArray(extra.sets) || !extra.sets.length) return { error: 'Un ejercicio añadido necesita al menos un set real.' }
    const mode = extra.mode === 'time' ? 'time' : 'reps'
    const parsed = validateEntries({ exercises: [{ entryId: `added-${entries.length}`, exerciseId, mode }] }, { entries: { [`added-${entries.length}`]: { ...extra, disposition: 'PERFORMED' } }, extras: [] })
    if (parsed.error) return parsed
    entries.push({ exerciseId, disposition: 'ADDED', sets: parsed.entries[0].sets })
  }
  return { entries }
}

export default function ClientTraining({ client, access, reportHttpError }) {
  const [online, setOnline] = useState(onlineNow)
  const [plan, setPlan] = useState(null)
  const [goals, setGoals] = useState(null)
  const [sessionSet, setSessionSet] = useState(null)
  const [current, setCurrent] = useState(null)
  const [closeOnly, setCloseOnly] = useState(null)
  const [recoveryUnavailable, setRecoveryUnavailable] = useState(false)
  const [actual, setActual] = useState(null)
  const [executions, setExecutions] = useState([])
  const [executionCursor, setExecutionCursor] = useState(null)
  const [weights, setWeights] = useState([])
  const [weightToken, setWeightToken] = useState(null)
  const [weight, setWeight] = useState('')
  const [weightUnit, setWeightUnit] = useState('KG')
  const [reportedDatePanama, setReportedDatePanama] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(null)
  const generation = useRef(0)
  const moreLoading = useRef(false)
  const accountId = access?.account?.id || null
  const accessRequestId = access?.requestId || null
  const accountRef = useRef(accountId)
  const ownerChanged = accountRef.current !== accountId
  // Invalidate before effects run so a deferred account-A response cannot paint into B.
  if (ownerChanged) { accountRef.current = accountId; generation.current++ }
  const allowed = ownAccess(access) && online

  useEffect(() => {
    const update = () => setOnline(onlineNow())
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

  const reset = () => {
    generation.current++
    setPlan(null); setGoals(null); setSessionSet(null); setCurrent(null); setCloseOnly(null); setRecoveryUnavailable(false); setActual(null); setExecutions([]); setExecutionCursor(null); setWeights([]); setWeightToken(null); setPending(null)
  }
  useEffect(() => {
    reset()
    if (!allowed || !client) return
    const mine = generation.current
    const accept = fn => value => { if (generation.current === mine) fn(value); return value }
    const fail = area => error => { if (generation.current !== mine) return; reportHttpError?.(error); if (area === 'plan') setNotice('No se pudo leer la prescripción actual. Tus registros propios se consultan por separado.'); else if (area === 'own') setNotice('No se pudieron actualizar tus registros propios.'); else setNotice('No se pudo confirmar la sesión abierta.') }
    client.getClientPlan?.().then(accept(value => { setPlan(value?.plan || null); setGoals(value?.goals || null); setSessionSet(token(value?.versionTokens, 'SESSION_SET')) })).catch(fail('plan'))
    client.getClientExecutions?.({}).then(accept(value => { setExecutions(Array.isArray(value?.items) ? value.items : []); setExecutionCursor(value?.nextCursor || null) })).catch(fail('own'))
    client.getClientBodyweight?.().then(accept(value => { setWeights(Array.isArray(value?.entries) ? value.entries : []); setWeightToken(token(value?.versionTokens, 'BODYWEIGHT_SET')) })).catch(fail('own'))
    client.getCurrentSession?.().then(accept(value => {
      const session = value?.session
      const sessionToken = token(value?.versionTokens, 'SESSION')
      if (session?.state === 'OPEN' && sessionToken && token(value?.versionTokens, 'SESSION_SET') && session?.snapshot && session.planVersionId === session.snapshot.planVersionId) setCurrent({ ...session, sessionToken, sessionSetToken: token(value.versionTokens, 'SESSION_SET') })
      else if (value?.closeOnlySession?.state === 'OPEN' && sessionToken) setCloseOnly({ ...value.closeOnlySession, sessionToken })
      else if (session?.state === 'OPEN') setNotice('La sesión abierta no tiene el token de servidor necesario para recuperarla con seguridad.')
    })).catch(fail('session'))
  // Access identity and online state deliberately invalidate all in-flight account reads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, accessRequestId, allowed, client])

  const draftStore = useMemo(() => {
    if (!accountId || !current?.sessionId || !current?.planVersionId || !current?.snapshot) return null
    try { return createClientTrainingDraftStore({ accountUid: accountId, serverSessionId: current.sessionId, planVersionId: current.planVersionId, goalVersionId: current.goalVersionId ?? null, originalSnapshot: current.snapshot }) } catch { return null }
  }, [accountId, current])
  useEffect(() => {
    if (!allowed || !actual || !draftStore) return
    try { draftStore.save({ ...actual, ...(pending?.type === 'finish' ? { pendingIntent: pending } : {}) }) } catch { setNotice('No se pudo guardar el borrador local; no se ha enviado nada al servidor.') }
  }, [actual, allowed, draftStore, pending])

  const useSession = session => {
    if (!session?.snapshot || !session.sessionToken) return
    setCurrent(session); setCloseOnly(null); setRecoveryUnavailable(false)
    setActual({ entries: Object.fromEntries((session.snapshot.exercises || []).map(entry => [entry.entryId, snapshotExercise(entry)])), extras: [] })
  }
  const start = async () => {
    if (!allowed || !plan || !sessionSet || pending || current || closeOnly) return
    let intent
    try { intent = { type: 'start', operationId: uuid(), expectedVersion: sessionSet.version, payload: { planVersionId: plan.id } } } catch (error) { setNotice(error.message); return }
    setPending(intent); setNotice('')
    try { const receipt = await client.startSession(intent); acceptStart(receipt, intent) } catch (error) { reportHttpError?.(error); setNotice('No se pudo confirmar el inicio. Reintenta exactamente la misma operación.'); }
  }
  const acceptStart = (receipt, intent) => {
    const result = receipt?.result; const sessionToken = token(receipt?.versionTokens, 'SESSION')
    if (!result?.sessionId || result?.state !== 'OPEN' || !result.snapshot || !sessionToken) { setNotice('El servidor no devolvió una sesión verificable; no se creó un registro local.'); return }
    setPending(null); useSession({ sessionId: result.sessionId, planVersionId: result.snapshot.planVersionId, goalVersionId: result.snapshot.goalVersionId ?? null, snapshot: result.snapshot, serverStartedAtUtc: result.serverStartedAtUtc, state: 'OPEN', sessionToken, sessionSetToken: token(receipt.versionTokens, 'SESSION_SET') }); setNotice('Sesión iniciada por el servidor. Registra los datos reales.')
  }
  const recover = () => {
    if (!allowed || !current) return
    if (!draftStore) { setRecoveryUnavailable(true); setNotice('No hay un borrador local compatible para esta sesión.'); return }
    try {
      const recovered = draftStore.recover()
      if (!recovered) { setRecoveryUnavailable(true); setNotice('No hay un borrador local compatible para esta sesión.'); return }
      const savedIntent = recovered.pendingIntent
      const safeIntent = savedIntent?.type === 'finish' && savedIntent?.payload?.sessionId === current.sessionId && Array.isArray(savedIntent?.payload?.entries) && typeof savedIntent.operationId === 'string' && Number.isSafeInteger(savedIntent.expectedVersion) ? savedIntent : null
      setRecoveryUnavailable(false); setActual({ entries: recovered.entries || {}, extras: recovered.extras || [] }); setPending(safeIntent); setNotice(safeIntent ? 'Borrador local e intento pendiente recuperados; el reintento sigue siendo manual.' : 'Borrador local recuperado; aún no se ha enviado.')
    } catch { setRecoveryUnavailable(true); setNotice('El borrador local no coincide con la sesión autorizada y no se adjuntó.') }
  }
  const changeEntry = (entryId, change) => setActual(value => ({ ...value, entries: { ...value.entries, [entryId]: { ...value.entries[entryId], ...change } } }))
  const changeSet = (entryId, index, change, extra = false) => setActual(value => {
    const owner = extra ? value.extras : value.entries; const row = extra ? owner[entryId] : owner[entryId]; const sets = row.sets.map((set, i) => i === index ? { ...set, ...change } : set); const next = { ...row, sets }
    return extra ? { ...value, extras: owner.map((item, i) => i === entryId ? next : item) } : { ...value, entries: { ...owner, [entryId]: next } }
  })
  const addSet = (entry, entryId, extra = false) => setActual(value => {
    if (extra) return { ...value, extras: value.extras.map((row, index) => index === entryId ? { ...row, sets: [...row.sets, blankSet(row.mode)] } : row) }
    const row = value.entries[entryId]; return { ...value, entries: { ...value.entries, [entryId]: { ...row, sets: [...row.sets, blankSet(entry.mode)] } } }
  })
  const finish = async () => {
    if (!allowed || !current || !actual || !current.sessionToken || pending) return
    const parsed = validateEntries(current.snapshot, actual); if (parsed.error) { setNotice(parsed.error); return }
    let intent
    try { intent = { type: 'finish', operationId: uuid(), expectedVersion: current.sessionToken.version, payload: { sessionId: current.sessionId, entries: parsed.entries } } } catch (error) { setNotice(error.message); return }
    setPending(intent); setNotice('')
    try { await acceptFinish(await client.finishSession(intent), intent) } catch (error) { reportHttpError?.(error); setNotice('No se pudo confirmar el final. Reintenta exactamente la misma operación.'); }
  }
  const acceptFinish = async (receipt, intent) => {
    const executionId = receipt?.result?.executionId
    if (!executionId) { setNotice('No se recibió un comprobante de finalización verificable.'); return }
    const readback = await client.getClientExecutions({})
    const items = Array.isArray(readback?.items) ? readback.items : []
    if (!items.some(row => row.executionId === executionId)) { setNotice('El servidor confirmó la operación, pero no se pudo verificar en tus registros. Reintenta la misma operación.'); return }
    setExecutions(items); setExecutionCursor(readback.nextCursor || null); draftStore?.clear(); setActual(null); setCurrent(null); setPending(null); setNotice('Sesión finalizada y verificada en tus registros SQLite asignados.')
  }
  const retry = async () => {
    if (!allowed || !pending || typeof client?.retry !== 'function') return
    try {
      const replay = async method => {
        if (typeof client.retry === 'function') {
          try { return await client.retry(pending.operationId) } catch (error) {
            // A recreated per-account API deliberately forgets its in-memory attempt map.  The
            // persisted intent is still safe to send once because operationId/body are identical.
            if (!/unknown operationId/i.test(String(error?.message || ''))) throw error
          }
        }
        return client[method](pending)
      }
      if (pending.type === 'start') acceptStart(await replay('startSession'), pending)
      else if (pending.type === 'finish') await acceptFinish(await replay('finishSession'), pending)
      else if (pending.type === 'weight') await acceptWeight(await replay('postBodyweight'))
      else if (pending.type === 'abandon') acceptAbandon(await replay('abandonSession'), pending)
    } catch (error) { reportHttpError?.(error); setNotice('El resultado sigue sin confirmarse. Conserva el mismo reintento.') }
  }
  const acceptAbandon = (receipt, intent) => { if (receipt?.result?.state !== 'CLOSED' || receipt?.result?.sessionId !== intent?.payload?.sessionId) { setNotice('No se recibió un cierre verificable.'); return } setPending(null); setCurrent(null); setCloseOnly(null); setRecoveryUnavailable(false); setActual(null); setNotice('Sesión abierta cerrada sin registrar ejecución.') }
  const abandon = async () => {
    const closable = closeOnly || (recoveryUnavailable ? current : null)
    if (!allowed || !closable?.sessionToken || !client?.abandonSession || pending) return
    const intent = { type: 'abandon', operationId: uuid(), expectedVersion: closable.sessionToken.version, payload: { sessionId: closable.sessionId } }; setPending(intent)
    try { acceptAbandon(await client.abandonSession(intent), intent) } catch (error) { reportHttpError?.(error); setNotice('No se pudo confirmar el cierre. Reintenta exactamente la misma operación.') }
  }
  const acceptWeight = async receipt => {
    if (!receipt?.result?.bodyweightId) { setNotice('No se recibió un comprobante de peso verificable.'); return }
    const latest = await client.getClientBodyweight(); setWeights(Array.isArray(latest?.entries) ? latest.entries : []); setWeightToken(token(latest?.versionTokens, 'BODYWEIGHT_SET')); setPending(null); setWeight(''); setNotice('Peso publicado y actualizado desde el servidor.')
  }
  const postWeight = async () => {
    const numeric = Number(weight)
    if (!allowed || !weightToken || pending || !Number.isFinite(numeric) || numeric < 1 || numeric > 500 || !panamaDate(reportedDatePanama)) { setNotice('Introduce peso válido y una fecha Panamá AAAA-MM-DD real; el servidor confirmará que no sea futura.'); return }
    const intent = { type: 'weight', operationId: uuid(), expectedVersion: weightToken.version, payload: { weight: numeric, unit: weightUnit, reportedDatePanama } }; setPending(intent)
    try { await acceptWeight(await client.postBodyweight(intent)) } catch (error) { reportHttpError?.(error); setNotice('No se pudo confirmar el peso. Reintenta exactamente la misma operación.') }
  }
  const loadMore = async () => {
    if (!allowed || !executionCursor || moreLoading.current) return
    moreLoading.current = true
    try { const page = await client.getClientExecutions({ cursor: executionCursor }); const rows = Array.isArray(page?.items) ? page.items : []; setExecutions(old => [...old, ...rows.filter(row => !old.some(item => item.executionId === row.executionId))]); setExecutionCursor(page?.nextCursor || null) } catch (error) { reportHttpError?.(error); setNotice('No se pudo cargar más registros.') } finally { moreLoading.current = false }
  }

  if (!allowed) return <section className="narrow" data-client-training="blocked"><h1>Entrenamiento no disponible</h1><p className="muted">Se requiere conexión y una autorización actual de cliente con suscripción vigente.</p></section>
  if (ownerChanged) return <section className="narrow" data-client-training="loading"><h1>Comprobando cuenta</h1></section>
  const busy = !!pending
  return <section className="narrow" data-client-training="ready">
    <h1>Mi entrenamiento</h1>
    {notice && <p role="status">{notice}</p>}
    {closeOnly && <section className="card"><h2>Sesión anterior sin acceso a la prescripción</h2><p>Por seguridad sólo puedes cerrarla; no se restauran objetivos ni datos anteriores.</p><button className="btn ghost" disabled={busy} onClick={abandon}>Cerrar sesión sin ejecución</button></section>}
    {current && !actual && <section className="card"><h2>Sesión abierta verificable</h2><p>La recuperación de datos locales es manual.</p><button className="btn" disabled={busy} onClick={recover}>Recuperar borrador local</button>{recoveryUnavailable && <><p>El borrador no puede restaurarse; puedes cerrar esta sesión sin registrar ejecución.</p><button className="btn ghost" disabled={busy} onClick={abandon}>Cerrar sesión sin ejecución</button></>}</section>}
    {!current && !closeOnly && <section className="card"><h2>Plan actual</h2>{plan ? <>{(plan.exercises || []).map(entry => <div key={entry.entryId}><strong>{nameOf(entry.exerciseId, entry)}</strong><p className="muted">{entry.sets} sets · {targetText(entry.commonTarget, entry.mode)}</p>{Object.entries(entry.setOverrides || {}).map(([index, target]) => <p className="muted" key={index}>Serie {Number(index) + 1}: {targetText(target, entry.mode)}</p>)}</div>)}<button className="btn" disabled={busy || !sessionSet} onClick={start}>Comenzar sesión</button></> : <p className="muted">No hay una prescripción disponible.</p>}</section>}
    {goals?.goals?.length > 0 && <section className="card"><h2>Objetivos publicados</h2>{goals.goals.map((goal, index) => <div key={`${goal.label}-${index}`}><strong>{goal.label}</strong><p className="muted">{goalText(goal)}{goal.dueDatePanama ? ` · fecha objetivo ${goal.dueDatePanama}` : ' · sin fecha objetivo'}</p></div>)}</section>}
    {current && actual && <section className="card"><h2>Registrar datos reales</h2>{(current.snapshot.exercises || []).map(entry => <EntryEditor key={entry.entryId} entry={entry} row={actual.entries[entry.entryId]} onChange={changeEntry} onAddSet={addSet} onChangeSet={changeSet} />)}<h3>Añadidos</h3>{actual.extras.map((row, index) => <ExtraEditor key={index} index={index} row={row} onChange={change => setActual(value => ({ ...value, extras: value.extras.map((item, i) => i === index ? { ...item, ...change } : item) }))} onAddSet={addSet} onChangeSet={changeSet} />)}<button className="btn ghost" disabled={busy} onClick={() => setActual(value => ({ ...value, extras: [...value.extras, { exerciseId: '', mode: 'reps', sets: [] }] }))}>Añadir ejercicio real</button><button className="btn" disabled={busy} onClick={finish}>Finalizar y verificar</button></section>}
    <section className="card"><h2>Peso propio</h2><label>Peso <input aria-label="Peso" value={weight} inputMode="decimal" onChange={event => setWeight(event.target.value)} /></label><label>Unidad <select aria-label="Unidad de peso" value={weightUnit} onChange={event => setWeightUnit(event.target.value)}><option value="KG">kg</option><option value="LB">lb</option></select></label><label>Fecha Panamá <input aria-label="Fecha Panamá" placeholder="AAAA-MM-DD" value={reportedDatePanama} onChange={event => setReportedDatePanama(event.target.value)} /></label><button className="btn" disabled={busy || !weightToken} onClick={postWeight}>Publicar peso</button>{weights.map(row => <p key={`${row.sourceKind}:${row.sourceRecordId}`}>{row.reportedDatePanama}: {row.weight} {row.unit}</p>)}</section>
    <section className="card"><h2>Mis ejecuciones SQLite asignadas</h2>{executions.map(row => <article key={row.executionId}><strong>{row.submittedAtUtc}</strong>{(row.actual?.entries || row.entries || []).map((entry, entryIndex) => <div key={`${entry.planEntryId || entry.exerciseId}-${entryIndex}`}><p>{nameOf(entry.exerciseId, entry)} · {entry.disposition}</p>{(entry.sets || []).map((set, setIndex) => <p className="muted" key={setIndex}>Serie real {setIndex + 1}: {actualSetText(set)}</p>)}</div>)}</article>)}{executionCursor && <button className="btn ghost" onClick={loadMore}>Cargar más</button>}</section>
    {pending && <button className="btn" onClick={retry}>Reintentar la misma operación</button>}
  </section>
}

function EntryEditor({ entry, row, onChange, onAddSet, onChangeSet }) {
  const mode = entry.mode
  return <article data-plan-entry-id={entry.entryId}><h3>{nameOf(entry.exerciseId, entry)}</h3><p className="muted">Objetivo (solo lectura): {targetText(entry.commonTarget, mode)}</p><label>Resultado <select value={row.disposition} onChange={event => onChange(entry.entryId, { disposition: event.target.value })}><option value="PERFORMED">Realizado</option><option value="OMITTED">Omitido</option><option value="SUBSTITUTED">Sustituido</option></select></label>{row.disposition === 'SUBSTITUTED' && <label>ID del ejercicio sustituto <input value={row.substituteId} onChange={event => onChange(entry.entryId, { substituteId: event.target.value })} /></label>}{row.disposition !== 'OMITTED' && <><button className="btn ghost" onClick={() => onAddSet(entry, entry.entryId)}>Añadir set real</button>{row.sets.map((set, index) => <SetEditor key={index} mode={mode} set={set} target={targetAt(entry, index)} onChange={change => onChangeSet(entry.entryId, index, change)} />)}</>}</article>
}
function ExtraEditor({ index, row, onChange, onAddSet, onChangeSet }) {
  return <article><label>ID del ejercicio añadido <input value={row.exerciseId} onChange={event => onChange({ exerciseId: event.target.value })} /></label><label>Modo <select value={row.mode} onChange={event => onChange({ mode: event.target.value })}><option value="reps">Repeticiones</option><option value="time">Tiempo</option></select></label><button className="btn ghost" onClick={() => onAddSet(row, index, true)}>Añadir set real</button>{row.sets.map((set, setIndex) => <SetEditor key={setIndex} mode={row.mode} set={set} onChange={change => onChangeSet(index, setIndex, change, true)} />)}</article>
}
function SetEditor({ mode, set, target, onChange }) {
  const amount = mode === 'time' ? 'seconds' : 'reps'
  return <fieldset><legend>Set real {target ? `· objetivo: ${targetText(target, mode)}` : ''}</legend><label>Fase <select value={set.phase} onChange={event => onChange({ phase: event.target.value })}><option value="work">Trabajo</option><option value="warmup">Calentamiento</option></select></label><label>{mode === 'time' ? 'Segundos' : 'Repeticiones'} <input value={set[amount]} inputMode="numeric" onChange={event => onChange({ [amount]: event.target.value })} /></label><label><input type="checkbox" checked={set.completed} onChange={event => onChange({ completed: event.target.checked })} /> Completado</label><label>Carga <select value={set.loadKind} onChange={event => onChange({ loadKind: event.target.value })}><option value="none">Sin declarar</option><option value="BODY_WEIGHT">Peso corporal</option><option value="EXTERNAL">Externa</option><option value="ASSISTANCE">Asistencia</option></select></label>{set.loadKind === 'EXTERNAL' || set.loadKind === 'ASSISTANCE' ? <label>kg <input value={set.kg} inputMode="decimal" onChange={event => onChange({ kg: event.target.value })} /></label> : null}{set.phase === 'work' && <><label>Esfuerzo <select value={set.effortKind} onChange={event => onChange({ effortKind: event.target.value })}><option value="">Sin declarar</option><option value="RPE">RPE</option><option value="RIR">RIR</option></select></label>{set.effortKind && <label>{set.effortKind} <input value={set.effortValue} inputMode="decimal" onChange={event => onChange({ effortValue: event.target.value })} /></label>}<label><input type="checkbox" checked={set.failure} onChange={event => onChange({ failure: event.target.checked })} /> Fallo</label></>}</fieldset>
}
