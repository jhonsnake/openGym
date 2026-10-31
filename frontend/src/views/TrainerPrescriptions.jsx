import { useEffect, useMemo, useRef, useState } from "react";
import { CATALOGUE, searchExercises } from "../lib/exercises.js";

const token = (xs, kind) =>
  Array.isArray(xs)
    ? xs.find(
        (x) =>
          x?.kind === kind && Number.isSafeInteger(x.version) && x.version >= 0,
      ) || null
    : null;
const op = () => {
  const id = globalThis.crypto?.randomUUID?.();
  if (!id) throw new Error("No se pudo crear una operación segura.");
  return id;
};
const catalog = CATALOGUE;
const CATALOGUE_INDEX = Object.fromEntries(
  CATALOGUE.map((exercise) => [exercise.id, exercise]),
);
const blankTarget = (mode) =>
  mode === "time"
    ? { seconds: "30" }
    : {
        form: "exact",
        exact: "8",
        min: "",
        max: "",
        loadKind: "",
        kg: "",
        effortKind: "",
        effortValue: "",
      };
const targetDraft = (target, mode) =>
  mode === "time"
    ? { seconds: target?.seconds ?? "" }
    : {
        form: target?.reps?.exact !== undefined ? "exact" : "range",
        exact: target?.reps?.exact ?? "",
        min: target?.reps?.min ?? "",
        max: target?.reps?.max ?? "",
        loadKind: target?.load?.kind ?? "",
        kg: target?.load?.kg ?? "",
        effortKind: target?.effort?.kind ?? "",
        effortValue: target?.effort?.value ?? "",
      };
const blankExercise = () => ({
  exerciseId: "0001",
  query: "",
  mode: "reps",
  sets: "1",
  restSeconds: "",
  commonTarget: blankTarget("reps"),
  setOverrides: {},
});
const blankGoal = {
  label: "",
  kind: "CONSISTENCY",
  dueDatePanama: "",
  targetSessionsPerWeek: "3",
  targetWeight: "",
  unit: "KG",
  exerciseId: "0001",
  query: "",
  targetLoadKind: "EXTERNAL",
  targetLoadKg: "",
  targetReps: "",
};
const editable = (plan) =>
  plan?.exercises?.length
    ? plan.exercises.map(
        ({ entryId, commonTarget, setOverrides, restSeconds, ...row }) => ({
          ...row,
          query: "",
          sets: String(row.sets),
          restSeconds: restSeconds ?? "",
          commonTarget: targetDraft(commonTarget, row.mode),
          setOverrides: Object.fromEntries(
            Object.entries(setOverrides || {}).map(([k, v]) => [
              k,
              targetDraft(v, row.mode),
            ]),
          ),
        }),
      )
    : [blankExercise()];
const name = (id, entry) =>
  CATALOGUE_INDEX[id]?.n ||
  (typeof entry?.exerciseName === "string" && entry.exerciseName
    ? entry.exerciseName
    : id);
const loadText = (load) =>
  !load
    ? "Sin carga declarada"
    : load.kind === "BODY_WEIGHT"
      ? "Peso corporal"
      : load.kind === "ASSISTANCE"
        ? `Asistencia ${load.kg} kg`
        : load.kind === "EXTERNAL"
          ? `Carga ${load.kg} kg`
          : load.kind === "REPORTED_UNKNOWN"
            ? `Carga reportada desconocida ${load.value} ${load.unit}`
            : "Carga no declarada";
const targetText = (target, mode) => {
  if (!target) return "Sin objetivo publicado";
  if (mode === "time") return `${target.seconds} s`;
  const reps =
    target.reps?.exact ??
    (target.reps
      ? `${target.reps.min}–${target.reps.max}`
      : "Sin repeticiones");
  return [
    `${reps} repeticiones`,
    target.load ? loadText(target.load) : "",
    target.effort ? `${target.effort.kind} ${target.effort.value}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
};
const setText = (set) =>
  [
    set.phase === "warmup" ? "calentamiento" : "trabajo",
    set.reps !== undefined
      ? `${set.reps} repeticiones`
      : set.seconds !== undefined
        ? `${set.seconds} s`
        : set.minutes !== undefined
          ? `${set.minutes} min`
          : "sin cantidad",
    set.side === "L" || set.side === "R" ? `lado ${set.side}` : "",
    set.load ? loadText(set.load) : "",
    set.effort ? `${set.effort.kind} ${set.effort.value}` : "",
    set.completed === false
      ? "no completado"
      : set.completed === true
        ? "completado"
        : "",
    set.failure ? "fallo" : "",
  ]
    .filter(Boolean)
    .join(" · ");
const requiredNumber = (value) =>
  (typeof value === "string" && value.trim() === "") ||
  value === null ||
  value === undefined
    ? Number.NaN
    : Number(value);

function parsedTarget(draft, mode, label) {
  if (mode === "time") {
    const seconds = Number(draft.seconds);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 21600)
      throw new Error(`${label}: el tiempo debe ser de 1 a 21600 segundos.`);
    return { seconds };
  }
  const reps =
    draft.form === "range"
      ? (() => {
          const min = Number(draft.min),
            max = Number(draft.max);
          if (
            !Number.isInteger(min) ||
            !Number.isInteger(max) ||
            min < 1 ||
            max > 1000 ||
            min > max
          )
            throw new Error(`${label}: el rango debe ser de 1 a 1000.`);
          return { min, max };
        })()
      : (() => {
          const exact = Number(draft.exact);
          if (!Number.isInteger(exact) || exact < 1 || exact > 1000)
            throw new Error(
              `${label}: las repeticiones deben ser de 1 a 1000.`,
            );
          return { exact };
        })();
  const out = { reps };
  if (draft.loadKind) {
    if (draft.loadKind === "BODY_WEIGHT") out.load = { kind: "BODY_WEIGHT" };
    else {
      const kg = requiredNumber(draft.kg);
      if (
        !["EXTERNAL", "ASSISTANCE"].includes(draft.loadKind) ||
        !Number.isFinite(kg) ||
        kg < 0 ||
        kg > 2000
      )
        throw new Error(`${label}: carga inválida.`);
      out.load = { kind: draft.loadKind, kg };
    }
  }
  if (draft.effortKind) {
    const value = requiredNumber(draft.effortValue),
      min = draft.effortKind === "RPE" ? 6 : 0;
    if (
      !["RPE", "RIR"].includes(draft.effortKind) ||
      !Number.isFinite(value) ||
      value < min ||
      value > 10 ||
      Math.round(value * 2) !== value * 2
    )
      throw new Error(`${label}: esfuerzo inválido.`);
    out.effort = { kind: draft.effortKind, value };
  }
  return out;
}
function parseExercises(rows) {
  return rows.map((row, i) => {
    const sets = Number(row.sets);
    if (
      typeof row.exerciseId !== "string" ||
      !row.exerciseId ||
      row.exerciseId.trim() !== row.exerciseId ||
      !Number.isInteger(sets) ||
      sets < 1 ||
      sets > 50
    )
      throw new Error(
        "Cada ejercicio requiere un ID literal y de 1 a 50 series.",
      );
    const out = {
      exerciseId: row.exerciseId,
      mode: row.mode,
      sets,
      commonTarget: parsedTarget(
        row.commonTarget,
        row.mode,
        `Ejercicio ${i + 1}`,
      ),
      setOverrides: {},
    };
    if (row.restSeconds !== "") {
      const restSeconds = Number(row.restSeconds);
      if (
        !Number.isInteger(restSeconds) ||
        restSeconds < 0 ||
        restSeconds > 21600
      )
        throw new Error("Descanso inválido.");
      out.restSeconds = restSeconds;
    }
    Object.entries(row.setOverrides).forEach(([k, target]) => {
      if (!/^(0|[1-9]\d*)$/.test(k) || Number(k) >= sets)
        throw new Error("El ajuste de serie ya no existe.");
      out.setOverrides[k] = parsedTarget(
        target,
        row.mode,
        `Ejercicio ${i + 1}, serie ${Number(k) + 1}`,
      );
    });
    return out;
  });
}
export function parseGoal(goal) {
  const label = String(goal.label || "").trim(),
    due = goal.dueDatePanama ? { dueDatePanama: goal.dueDatePanama } : {};
  if (!label || label.length > 120)
    throw new Error("La meta requiere una etiqueta de 1 a 120 caracteres.");
  if (goal.kind === "CONSISTENCY") {
    const n = Number(goal.targetSessionsPerWeek);
    if (!Number.isInteger(n) || n < 1 || n > 365)
      throw new Error("Frecuencia inválida.");
    return { label, kind: goal.kind, targetSessionsPerWeek: n, ...due };
  }
  if (goal.kind === "BODY_WEIGHT") {
    const n = Number(goal.targetWeight);
    if (!Number.isFinite(n) || n < 1 || n > 500)
      throw new Error("Peso objetivo inválido.");
    return {
      label,
      kind: goal.kind,
      targetWeight: n,
      unit: goal.unit === "LB" ? "LB" : "KG",
      ...due,
    };
  }
  const reps = Number(goal.targetReps);
  if (
    typeof goal.exerciseId !== "string" ||
    !goal.exerciseId ||
    goal.exerciseId.trim() !== goal.exerciseId ||
    !Number.isInteger(reps) ||
    reps < 1 ||
    reps > 1000
  )
    throw new Error("Meta de rendimiento incompleta.");
  const targetLoad =
    goal.targetLoadKind === "BODY_WEIGHT"
      ? { kind: "BODY_WEIGHT" }
      : (() => {
          const kg = requiredNumber(goal.targetLoadKg);
          if (
            !["EXTERNAL", "ASSISTANCE"].includes(goal.targetLoadKind) ||
            !Number.isFinite(kg) ||
            kg < 0 ||
            kg > 2000
          )
            throw new Error("Carga de rendimiento inválida.");
          return { kind: goal.targetLoadKind, kg };
        })();
  return {
    label,
    kind: "PERFORMANCE",
    exerciseId: goal.exerciseId,
    targetLoad,
    targetReps: reps,
    ...due,
  };
}
function ExercisePicker({ value, query, label, change }) {
  const options = useMemo(
    () => searchExercises(catalog, query || "").slice(0, 30),
    [query],
  );
  return (
    <>
      <label>
        Buscar ejercicio{" "}
        <input
          aria-label={`Buscar ejercicio ${label}`}
          value={query}
          onChange={(e) => change({ query: e.target.value })}
          placeholder="Nombre o equipo"
        />
      </label>
      <label>
        Ejercicio{" "}
        <select
          aria-label={`Ejercicio ${label}`}
          value={value}
          onChange={(e) => change({ exerciseId: e.target.value })}
        >
          {!CATALOGUE_INDEX[value] && value && (
            <option value={value}>{value}</option>
          )}
          {options.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.n} · {ex.id}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
function TargetEditor({ value, mode, label, change }) {
  const patch = (next) => change({ ...value, ...next });
  if (mode === "time")
    return (
      <label>
        {label} segundos{" "}
        <input
          type="number"
          min="1"
          max="21600"
          step="1"
          value={value.seconds}
          onChange={(e) => patch({ seconds: e.target.value })}
        />
      </label>
    );
  return (
    <div data-target-editor={label}>
      <label>
        {label} repeticiones{" "}
        <select
          value={value.form}
          onChange={(e) => patch({ form: e.target.value })}
        >
          <option value="exact">Exactas</option>
          <option value="range">Rango</option>
        </select>
      </label>
      {value.form === "range" ? (
        <>
          <label>
            Mínimo{" "}
            <input
              type="number"
              min="1"
              max="1000"
              step="1"
              value={value.min}
              onChange={(e) => patch({ min: e.target.value })}
            />
          </label>
          <label>
            Máximo{" "}
            <input
              type="number"
              min="1"
              max="1000"
              step="1"
              value={value.max}
              onChange={(e) => patch({ max: e.target.value })}
            />
          </label>
        </>
      ) : (
        <label>
          Exactas{" "}
          <input
            type="number"
            min="1"
            max="1000"
            step="1"
            value={value.exact}
            onChange={(e) => patch({ exact: e.target.value })}
          />
        </label>
      )}
      <label>
        Carga{" "}
        <select
          value={value.loadKind}
          onChange={(e) =>
            patch({
              loadKind: e.target.value,
              ...(e.target.value === "BODY_WEIGHT" ? { kg: "" } : {}),
            })
          }
        >
          <option value="">Sin prescribir</option>
          <option value="BODY_WEIGHT">Peso corporal</option>
          <option value="EXTERNAL">Externa</option>
          <option value="ASSISTANCE">Asistencia</option>
        </select>
      </label>
      {["EXTERNAL", "ASSISTANCE"].includes(value.loadKind) && (
        <label>
          kg{" "}
          <input
            type="number"
            min="0"
            max="2000"
            step="0.1"
            inputMode="decimal"
            value={value.kg}
            onChange={(e) => patch({ kg: e.target.value })}
          />
        </label>
      )}
      <label>
        Esfuerzo{" "}
        <select
          value={value.effortKind}
          onChange={(e) =>
            patch({
              effortKind: e.target.value,
              ...(e.target.value ? {} : { effortValue: "" }),
            })
          }
        >
          <option value="">Sin prescribir</option>
          <option value="RPE">RPE</option>
          <option value="RIR">RIR</option>
        </select>
      </label>
      {value.effortKind && (
        <label>
          {value.effortKind}{" "}
          <input
            type="number"
            min={value.effortKind === "RPE" ? "6" : "0"}
            max="10"
            step="0.5"
            inputMode="decimal"
            value={value.effortValue}
            onChange={(e) => patch({ effortValue: e.target.value })}
          />
        </label>
      )}
    </div>
  );
}
function PlanReadback({ plan, goals }) {
  return (
    <section>
      <h3>Versiones publicadas (inmutables)</h3>
      <p className="muted">
        Plan actual: {plan ? `v${plan.versionNumber}` : "sin versión"} · Meta
        actual: {goals ? `v${goals.versionNumber}` : "sin versión"}.
      </p>
      {plan?.exercises?.map((row, i) => (
        <article key={row.entryId || i}>
          <strong>{name(row.exerciseId)}</strong>
          <p className="muted">
            {row.sets} series · {targetText(row.commonTarget, row.mode)}
            {row.restSeconds !== undefined
              ? ` · descanso ${row.restSeconds} s`
              : ""}
          </p>
          {Object.entries(row.setOverrides || {}).map(([set, target]) => (
            <p className="muted" key={set}>
              Serie {Number(set) + 1}: {targetText(target, row.mode)}
            </p>
          ))}
        </article>
      ))}
      {goals?.goals?.map((goal, i) => (
        <article key={i}>
          <strong>{goal.label}</strong>
          <p className="muted">
            {goal.kind === "CONSISTENCY"
              ? `${goal.targetSessionsPerWeek} sesiones/semana`
              : goal.kind === "BODY_WEIGHT"
                ? `${goal.targetWeight} ${goal.unit}`
                : `${name(goal.exerciseId)} · ${loadText(goal.targetLoad)} · ${goal.targetReps} repeticiones`}
            {goal.dueDatePanama
              ? ` · fecha objetivo ${goal.dueDatePanama}`
              : " · sin fecha objetivo"}
          </p>
        </article>
      ))}
    </section>
  );
}
function ActualRows({ items }) {
  return (
    <>
      {items.map((item) => (
        <article key={item.executionId}>
          <strong>Actual {item.submittedAtUtc}</strong>
          {(item.actual?.entries || []).map((entry, i) => (
            <div key={i}>
              <p>
                {name(entry.exerciseId, entry)} · {entry.disposition}
              </p>
              {entry.sets?.map((set, n) => (
                <p className="muted" key={n}>
                  Serie real {n + 1}: {setText(set)}
                </p>
              ))}
            </div>
          ))}
        </article>
      ))}
    </>
  );
}
function HistoryRows({ items, includeWeight }) {
  return (
    <>
      {items
        .filter((x) => x?.kind !== "BODY_WEIGHT" || includeWeight)
        .map((item, i) =>
          item.kind === "BODY_WEIGHT" ? (
            <article key={item.sourceRecordId || i}>
              <strong>Peso compartido</strong>
              <p className="muted">
                {item.reportedDate}: {item.value} {item.unit}
              </p>
            </article>
          ) : (
            <article key={item.sourceRecordId || i}>
              <strong>{item.reportedAtUtc ?? item.reportedDate}</strong>
              {item.exercises?.map((entry, ei) => (
                <div key={ei}>
                  <p>{name(entry.exerciseId, entry)}</p>
                  {entry.sets?.map((set, si) => (
                    <p className="muted" key={si}>
                      Serie real {si + 1}: {setText(set)}
                    </p>
                  ))}
                </div>
              ))}
            </article>
          ),
        )}
    </>
  );
}

export default function TrainerPrescriptions({
  client,
  portfolio = [],
  reportHttpError,
}) {
  const [relationId, setRelationId] = useState("");
  const [read, setRead] = useState({ state: "idle" });
  const [exercises, setExercises] = useState([blankExercise()]);
  const [goal, setGoal] = useState(blankGoal);
  const [selectedGoalVersionId, setSelectedGoalVersionId] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(null);
  const [executions, setExecutions] = useState([]),
    [executionCursor, setExecutionCursor] = useState(null),
    [historyGrantId, setHistoryGrantId] = useState(""),
    [history, setHistory] = useState([]),
    [historyCursor, setHistoryCursor] = useState(null),
    [weights, setWeights] = useState([]),
    [weightCursor, setWeightCursor] = useState(null);
  const generation = useRef(0),
    mounted = useRef(true);
  const relation = portfolio.find((x) => x.relationId === relationId) || null;
  const grants = Array.isArray(relation?.grants)
    ? relation.grants.filter((x) => x?.state === "ACTIVE")
    : null;
  const context = relation
    ? JSON.stringify({
        relationId,
        clientId: relation.clientId || relation.clientAlias || null,
        state: relation.state,
        version: relation.version ?? null,
        grants: (grants || [])
          .map((x) => ({
            grantId: x.grantId,
            kind: x.kind,
            state: x.state,
            version: x.version ?? null,
            startUtc: x.startUtc ?? null,
            endExclusiveUtc: x.endExclusiveUtc ?? null,
            includeWeight: x.includeWeight === true,
          }))
          .sort((a, b) => String(a.grantId).localeCompare(String(b.grantId))),
      })
    : "";
  const contextRef = useRef(context),
    clientRef = useRef(client);
  if (contextRef.current !== context) contextRef.current = context;
  if (clientRef.current !== client) clientRef.current = client;
  const planGrant = grants?.find((x) => x.kind === "PLAN") || null,
    executionGrant = grants?.find((x) => x.kind === "EXECUTION") || null,
    historyGrant =
      grants?.find(
        (x) => x.kind === "HISTORY" && x.grantId === historyGrantId,
      ) || null,
    weightGrant = grants?.find((x) => x.kind === "WEIGHT") || null;
  const historyRef = useRef(historyGrantId),
    weightRef = useRef(weightGrant?.grantId || "");
  if (historyRef.current !== historyGrantId)
    historyRef.current = historyGrantId;
  if (weightRef.current !== (weightGrant?.grantId || ""))
    weightRef.current = weightGrant?.grantId || "";
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    const mine = ++generation.current;
    setRead({ state: relationId ? "loading" : "idle" });
    setExercises([blankExercise()]);
    setGoal(blankGoal);
    setSelectedGoalVersionId("");
    setExecutions([]);
    setExecutionCursor(null);
    setHistory([]);
    setHistoryCursor(null);
    setWeights([]);
    setWeightCursor(null);
    setHistoryGrantId("");
    setMessage("");
    if (!relationId) return;
    if (!planGrant) {
      setRead({ state: "unavailable" });
      return;
    }
    if (!client?.getTrainerCurrentPlan || !client?.getTrainerCurrentGoals) {
      setRead({ state: "pending" });
      return;
    }
    Promise.all([
      client.getTrainerCurrentPlan({ relationId }),
      client.getTrainerCurrentGoals({ relationId }),
    ])
      .then(([planRead, goalRead]) => {
        if (
          !mounted.current ||
          generation.current !== mine ||
          contextRef.current !== context ||
          clientRef.current !== client
        )
          return;
        const planToken = token(planRead?.versionTokens, "PLAN_SET"),
          goalToken = token(goalRead?.versionTokens, "GOAL_SET");
        if (!planToken || !goalToken) {
          setRead({ state: "pending" });
          return;
        }
        setRead({
          state: "ready",
          plan: planRead.plan || null,
          goals: goalRead.goals || null,
          planToken,
          goalToken,
        });
        setExercises(editable(planRead.plan));
        setSelectedGoalVersionId(
          planRead.plan?.goalVersionId || goalRead.goals?.id || "",
        );
        const first = goalRead.goals?.goals?.[0];
        if (first)
          setGoal({
            ...blankGoal,
            ...first,
            dueDatePanama: first.dueDatePanama || "",
            targetLoadKind: first.targetLoad?.kind || "EXTERNAL",
            targetLoadKg: first.targetLoad?.kg ?? "",
          });
      })
      .catch((error) => {
        if (
          mounted.current &&
          generation.current === mine &&
          contextRef.current === context &&
          clientRef.current === client
        ) {
          reportHttpError?.(error);
          setRead({ state: "denied" });
        }
      });
  }, [context, client, relationId, reportHttpError]);
  const current = (request) =>
    mounted.current &&
    generation.current === request.generation &&
    contextRef.current === request.context &&
    clientRef.current === request.client &&
    relationId === request.relationId;
  const merge = (old, rows, id) => [
    ...old,
    ...rows.filter((row) => !old.some((x) => x?.[id] === row?.[id])),
  ];
  const mutate = async (type, method, expectedVersion, payload) => {
    if (!Number.isSafeInteger(expectedVersion))
      return setMessage(
        "La lectura no publicó la versión vigente; no se envió nada.",
      );
    const intent =
      pending?.type === type &&
      JSON.stringify(pending.payload) === JSON.stringify(payload) &&
      pending.expectedVersion === expectedVersion
        ? pending
        : { type, method, operationId: op(), expectedVersion, payload };
    setPending(intent);
    setMessage("");
    try {
      await client[method](intent);
      setPending(null);
      setRelationId((x) => (x === relationId ? "" : x));
      queueMicrotask(() => setRelationId(relationId));
      setMessage(
        type === "goal"
          ? "Meta publicada como versión independiente. Asóciala explícitamente al próximo plan."
          : "Plan publicado como una nueva versión inmutable.",
      );
    } catch (error) {
      reportHttpError?.(error);
      setMessage(
        error?.status === 409
          ? "Conflicto de versión: el borrador se conserva."
          : "No se pudo confirmar el resultado. Reintenta la misma operación.",
      );
    }
  };
  const readPage = async (kind, cursor) => {
    const request = {
      generation: generation.current,
      relationId,
      context,
      client,
      grantId:
        kind === "history"
          ? historyGrant?.grantId || ""
          : kind === "weight"
            ? weightGrant?.grantId || ""
            : "",
    };
    if (
      !relationId ||
      (kind === "execution" && !executionGrant) ||
      (kind === "history" && !historyGrant) ||
      (kind === "weight" && !weightGrant)
    )
      return;
    try {
      const page =
        kind === "execution"
          ? await client.getTrainerExecutions?.({
              relationId,
              ...(cursor ? { cursor } : {}),
            })
          : kind === "history"
            ? await client.getTrainerHistory?.({
                relationId,
                grantId: historyGrant.grantId,
                ...(cursor ? { cursor } : {}),
              })
            : await client.getTrainerBodyweight?.({
                relationId,
                ...(cursor ? { cursor } : {}),
              });
      if (
        !current(request) ||
        (kind === "history" && historyRef.current !== request.grantId) ||
        (kind === "weight" && weightRef.current !== request.grantId)
      )
        return;
      const rows = Array.isArray(page?.items)
        ? page.items
        : Array.isArray(page?.entries)
          ? page.entries
          : [];
      if (kind === "execution") {
        setExecutions((old) =>
          cursor ? merge(old, rows, "executionId") : rows,
        );
        setExecutionCursor(page?.nextCursor || null);
      }
      if (kind === "history") {
        setHistory((old) =>
          cursor ? merge(old, rows, "sourceRecordId") : rows,
        );
        setHistoryCursor(page?.nextCursor || null);
      }
      if (kind === "weight") {
        setWeights((old) =>
          cursor ? merge(old, rows, "sourceRecordId") : rows,
        );
        setWeightCursor(page?.nextCursor || null);
      }
    } catch (error) {
      if (
        current(request) &&
        (kind !== "history" || historyRef.current === request.grantId) &&
        (kind !== "weight" || weightRef.current === request.grantId)
      ) {
        reportHttpError?.(error);
        setMessage(
          kind === "execution"
            ? "El servidor no autorizó o no pudo leer ejecuciones reales."
            : kind === "history"
              ? "El historial seleccionado no está disponible."
              : "El peso no está disponible con el consentimiento vigente.",
        );
      }
    }
  };
  const updateExercise = (i, patch) =>
    setExercises((xs) => xs.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  const updateOverride = (i, set, target) =>
    updateExercise(i, {
      setOverrides: { ...exercises[i].setOverrides, [set]: target },
    });
  const removeOverride = (i, set) => {
    const next = { ...exercises[i].setOverrides };
    delete next[set];
    updateExercise(i, { setOverrides: next });
  };
  return (
    <section className="card" data-trainer-prescriptions="true">
      <h2>Prescripciones y metas</h2>
      <label>
        Cliente de cartera{" "}
        <select
          aria-label="Cliente de cartera"
          value={relationId}
          onChange={(e) => setRelationId(e.target.value)}
        >
          <option value="">Selecciona una relación vigente</option>
          {portfolio.map((row) => (
            <option key={row.relationId} value={row.relationId}>
              {row.clientId || row.clientAlias || row.relationId}
            </option>
          ))}
        </select>
      </label>
      {read.state === "loading" && (
        <p aria-live="polite">Leyendo versiones autorizadas…</p>
      )}
      {read.state === "pending" && (
        <p role="alert">
          Integración pendiente: faltan las versiones de plan/metas producidas
          por el servidor.
        </p>
      )}
      {read.state === "denied" && (
        <p role="alert">No se pudieron leer las versiones de esta relación.</p>
      )}
      {read.state === "ready" && (
        <>
          <PlanReadback plan={read.plan} goals={read.goals} />
          <form
            data-plan-editor
            onSubmit={(e) => {
              e.preventDefault();
              try {
                mutate("plan", "publishPlan", read.planToken?.version, {
                  relationId,
                  exercises: parseExercises(exercises),
                  ...(selectedGoalVersionId
                    ? { goalVersionId: selectedGoalVersionId }
                    : {}),
                });
              } catch (error) {
                setMessage(error.message);
              }
            }}
          >
            <h3>Nueva versión de plan</h3>
            <p className="muted">
              Editar este borrador nunca modifica la versión ya publicada ni
              sesiones iniciadas.
            </p>
            {exercises.map((row, i) => (
              <fieldset key={i}>
                <legend>Ejercicio {i + 1}</legend>
                <ExercisePicker
                  value={row.exerciseId}
                  query={row.query}
                  label={i + 1}
                  change={(patch) => updateExercise(i, patch)}
                />
                <label>
                  Modo{" "}
                  <select
                    value={row.mode}
                    onChange={(e) =>
                      updateExercise(i, {
                        mode: e.target.value,
                        commonTarget: blankTarget(e.target.value),
                        setOverrides: {},
                      })
                    }
                  >
                    <option value="reps">Repeticiones</option>
                    <option value="time">Duración</option>
                  </select>
                </label>
                <label>
                  Series{" "}
                  <input
                    type="number"
                    min="1"
                    max="50"
                    step="1"
                    value={row.sets}
                    onChange={(e) =>
                      updateExercise(i, {
                        sets: e.target.value,
                        setOverrides: Object.fromEntries(
                          Object.entries(row.setOverrides).filter(
                            ([k]) => Number(k) < Number(e.target.value),
                          ),
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Descanso (segundos, opcional){" "}
                  <input
                    type="number"
                    min="0"
                    max="21600"
                    step="1"
                    value={row.restSeconds}
                    onChange={(e) =>
                      updateExercise(i, { restSeconds: e.target.value })
                    }
                  />
                </label>
                <TargetEditor
                  value={row.commonTarget}
                  mode={row.mode}
                  label="Objetivo común"
                  change={(commonTarget) => updateExercise(i, { commonTarget })}
                />
                <h4>Ajustes por serie (opcionales)</h4>
                {Array.from(
                  { length: Math.min(Math.max(Number(row.sets) || 0, 0), 50) },
                  (_, set) =>
                    row.setOverrides[set] ? (
                      <fieldset key={set}>
                        <legend>Serie {set + 1}</legend>
                        <TargetEditor
                          value={row.setOverrides[set]}
                          mode={row.mode}
                          label={`Serie ${set + 1}`}
                          change={(target) => updateOverride(i, set, target)}
                        />
                        <button
                          type="button"
                          className="btn ghost"
                          onClick={() => removeOverride(i, set)}
                        >
                          Quitar ajuste de serie
                        </button>
                      </fieldset>
                    ) : (
                      <button
                        type="button"
                        className="btn ghost"
                        key={set}
                        onClick={() =>
                          updateOverride(
                            i,
                            set,
                            targetDraft(
                              parsedTarget(
                                row.commonTarget,
                                row.mode,
                                "Objetivo común",
                              ),
                              row.mode,
                            ),
                          )
                        }
                      >
                        Ajustar serie {set + 1}
                      </button>
                    ),
                )}
              </fieldset>
            ))}
            <button
              type="button"
              className="btn ghost"
              onClick={() => setExercises((xs) => [...xs, blankExercise()])}
            >
              Añadir ejercicio
            </button>
            {exercises.length > 1 && (
              <button
                type="button"
                className="btn ghost"
                onClick={() => setExercises((xs) => xs.slice(0, -1))}
              >
                Quitar último ejercicio
              </button>
            )}
            <label>
              Versión de meta a asociar{" "}
              <select
                value={selectedGoalVersionId}
                onChange={(e) => setSelectedGoalVersionId(e.target.value)}
              >
                <option value="">Sin meta</option>
                {read.goals?.id && (
                  <option value={read.goals.id}>
                    Meta actual v{read.goals.versionNumber}
                  </option>
                )}
              </select>
            </label>
            <button className="btn" disabled={!!pending}>
              Publicar nueva versión de plan
            </button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                mutate("goal", "publishGoals", read.goalToken?.version, {
                  relationId,
                  goals: [parseGoal(goal)],
                });
              } catch (error) {
                setMessage(error.message);
              }
            }}
          >
            <h3>Nueva versión de meta</h3>
            <label>
              Etiqueta{" "}
              <input
                value={goal.label}
                onChange={(e) =>
                  setGoal((x) => ({ ...x, label: e.target.value }))
                }
              />
            </label>
            <label>
              Fecha objetivo (opcional){" "}
              <input
                type="date"
                value={goal.dueDatePanama}
                onChange={(e) =>
                  setGoal((x) => ({ ...x, dueDatePanama: e.target.value }))
                }
              />
            </label>
            <label>
              Tipo{" "}
              <select
                value={goal.kind}
                onChange={(e) =>
                  setGoal((x) => ({
                    ...blankGoal,
                    label: x.label,
                    dueDatePanama: x.dueDatePanama,
                    kind: e.target.value,
                  }))
                }
              >
                <option value="CONSISTENCY">CONSISTENCY</option>
                <option value="BODY_WEIGHT">BODY_WEIGHT</option>
                <option value="PERFORMANCE">PERFORMANCE</option>
              </select>
            </label>
            {goal.kind === "CONSISTENCY" && (
              <label>
                Sesiones/semana{" "}
                <input
                  type="number"
                  min="1"
                  max="365"
                  step="1"
                  value={goal.targetSessionsPerWeek}
                  onChange={(e) =>
                    setGoal((x) => ({
                      ...x,
                      targetSessionsPerWeek: e.target.value,
                    }))
                  }
                />
              </label>
            )}
            {goal.kind === "BODY_WEIGHT" && (
              <>
                <label>
                  Peso objetivo{" "}
                  <input
                    type="number"
                    min="1"
                    max="500"
                    step="0.1"
                    inputMode="decimal"
                    value={goal.targetWeight}
                    onChange={(e) =>
                      setGoal((x) => ({ ...x, targetWeight: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Unidad{" "}
                  <select
                    value={goal.unit}
                    onChange={(e) =>
                      setGoal((x) => ({ ...x, unit: e.target.value }))
                    }
                  >
                    <option value="KG">kg</option>
                    <option value="LB">lb</option>
                  </select>
                </label>
                <p className="muted">
                  Esta meta no concede acceso a mediciones corporales.
                </p>
              </>
            )}
            {goal.kind === "PERFORMANCE" && (
              <>
                <ExercisePicker
                  value={goal.exerciseId}
                  query={goal.query}
                  label="meta"
                  change={(patch) => setGoal((x) => ({ ...x, ...patch }))}
                />
                <label>
                  Carga{" "}
                  <select
                    value={goal.targetLoadKind}
                    onChange={(e) =>
                      setGoal((x) => ({
                        ...x,
                        targetLoadKind: e.target.value,
                        ...(e.target.value === "BODY_WEIGHT"
                          ? { targetLoadKg: "" }
                          : {}),
                      }))
                    }
                  >
                    <option value="EXTERNAL">Externa</option>
                    <option value="ASSISTANCE">Asistencia</option>
                    <option value="BODY_WEIGHT">Peso corporal</option>
                  </select>
                </label>
                {goal.targetLoadKind !== "BODY_WEIGHT" && (
                  <label>
                    kg{" "}
                    <input
                      type="number"
                      min="0"
                      max="2000"
                      step="0.1"
                      inputMode="decimal"
                      value={goal.targetLoadKg}
                      onChange={(e) =>
                        setGoal((x) => ({ ...x, targetLoadKg: e.target.value }))
                      }
                    />
                  </label>
                )}
                <label>
                  Repeticiones{" "}
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    step="1"
                    value={goal.targetReps}
                    onChange={(e) =>
                      setGoal((x) => ({ ...x, targetReps: e.target.value }))
                    }
                  />
                </label>
              </>
            )}
            <button className="btn" disabled={!!pending}>
              Publicar meta independiente
            </button>
          </form>
        </>
      )}
      {relationId && (
        <section>
          <h3>Actividad autorizada</h3>
          <button
            className="btn ghost"
            disabled={!executionGrant}
            onClick={() => readPage("execution")}
          >
            Ver ejecuciones reales
          </button>
          {executions.length ? (
            <>
              <p>{executions.length} ejecuciones reales autorizadas.</p>
              <ActualRows items={executions} />
            </>
          ) : (
            <p className="muted">
              Las prescripciones no se muestran como ejecuciones reales.
            </p>
          )}
          {executionCursor && (
            <button
              className="btn ghost"
              onClick={() => readPage("execution", executionCursor)}
            >
              Cargar más ejecuciones
            </button>
          )}
          {grants === null ? (
            <p className="muted">
              Integración pendiente: el servidor aún no publicó IDs de grants
              para seleccionar historial.
            </p>
          ) : (
            <>
              <label>
                Rango de historial{" "}
                <select
                  value={historyGrantId}
                  onChange={(e) => {
                    setHistoryGrantId(e.target.value);
                    setHistory([]);
                    setHistoryCursor(null);
                  }}
                >
                  <option value="">Selecciona un grant HISTORY</option>
                  {grants
                    .filter((x) => x.kind === "HISTORY")
                    .map((x) => (
                      <option key={x.grantId} value={x.grantId}>
                        {x.startUtc} a {x.endExclusiveUtc}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="btn ghost"
                disabled={!historyGrant}
                onClick={() => readPage("history")}
              >
                Leer historial seleccionado
              </button>
              {history.length > 0 && (
                <>
                  <p>
                    {
                      history.filter(
                        (x) =>
                          x?.kind !== "BODY_WEIGHT" ||
                          (historyGrant?.includeWeight && weightGrant),
                      ).length
                    }{" "}
                    registros históricos autorizados.
                  </p>
                  <HistoryRows
                    items={history}
                    includeWeight={
                      historyGrant?.includeWeight === true && !!weightGrant
                    }
                  />
                </>
              )}
              {historyCursor && (
                <button
                  className="btn ghost"
                  onClick={() => readPage("history", historyCursor)}
                >
                  Cargar más historial
                </button>
              )}
              <button
                className="btn ghost"
                disabled={!weightGrant}
                onClick={() => readPage("weight")}
              >
                Leer peso con consentimiento WEIGHT
              </button>
              {weights.length > 0 && (
                <>
                  <p>{weights.length} medidas de peso autorizadas.</p>
                  {weights.map((x, i) => (
                    <p key={x.sourceRecordId || i}>
                      {x.reportedDatePanama}: {x.weight} {x.unit}
                    </p>
                  ))}
                </>
              )}
              {weightCursor && (
                <button
                  className="btn ghost"
                  onClick={() => readPage("weight", weightCursor)}
                >
                  Cargar más peso
                </button>
              )}
            </>
          )}
        </section>
      )}
      {message && <p role="status">{message}</p>}
      {pending && (
        <button
          className="btn"
          onClick={async () => {
            try {
              await client.retry(pending.operationId);
              setPending(null);
              setMessage(
                "Operación confirmada; recarga la relación para verificar la nueva versión.",
              );
            } catch (error) {
              reportHttpError?.(error);
              setMessage(
                "El resultado sigue sin confirmarse; el borrador permanece intacto.",
              );
            }
          }}
        >
          Reintentar la misma operación
        </button>
      )}
    </section>
  );
}
