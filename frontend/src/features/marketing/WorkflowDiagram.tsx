import { Pause, Play, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/cn'

import {
  EDGES,
  EDGES_BY_ID,
  NODES,
  NODES_BY_ID,
  NODE_H,
  NODE_W,
  SCENARIOS,
  SCENE_HEIGHT,
  SCENE_WIDTH,
  walkthrough,
  type SceneNode,
  type Scenario,
} from './scene'

/**
 * The auto-playing workflow story.
 *
 * How it is built, and why:
 *
 *  - **One clock.** A single `requestAnimationFrame` loop owns `elapsed`,
 *    `phase`, `paused` and `scenario`. Nodes and edges do not each run a timer,
 *    so nothing can drift out of step and pausing is exact.
 *  - **React state changes only at phase boundaries.** Sixty times a second the
 *    loop writes directly to two DOM nodes — the packet's transform and the lit
 *    edge's `stroke-dashoffset`. Re-rendering the page every frame for a
 *    marketing animation would be indefensible.
 *  - **SVG draws the connectors; HTML draws the nodes.** Text in SVG cannot use
 *    the type system properly, cannot wrap well and is awkward to make
 *    focusable. The nodes are real buttons positioned in percentages over the
 *    same coordinate space, so the geometry stays in one place.
 *  - **It stops when nobody is watching.** Off-screen or in a hidden tab the
 *    loop is cancelled and `elapsed` is kept, so returning resumes from the same
 *    point instead of replaying every missed timer at once.
 */

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const WIDE_QUERY = '(min-width: 900px)'

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )
  useEffect(() => {
    const list = window.matchMedia(query)
    const update = () => setMatches(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])
  return matches
}

const pct = (value: number, total: number) => `${(value / total) * 100}%`

interface ClockState {
  phase: number
  /** 0–1 through the current phase's travel. 1 during its hold. */
  progress: number
  /** True once the packet has landed and the node is being emphasised. */
  arrived: boolean
}

export function WorkflowDiagram({ className }: { className?: string }) {
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY)
  const wide = useMediaQuery(WIDE_QUERY)

  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id)
  const scenario = useMemo(
    () => SCENARIOS.find((entry) => entry.id === scenarioId) ?? SCENARIOS[0],
    [scenarioId],
  )

  const [paused, setPaused] = useState(false)
  const [visible, setVisible] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [clock, setClock] = useState<ClockState>({ phase: 0, progress: 0, arrived: false })

  const containerRef = useRef<HTMLDivElement | null>(null)
  const packetRef = useRef<HTMLDivElement | null>(null)
  const pathRefs = useRef<Record<string, SVGPathElement | null>>({})
  const litRefs = useRef<Record<string, SVGPathElement | null>>({})

  // Mutable clock state. Deliberately outside React: the loop reads and writes
  // this every frame and must not queue a render to do so.
  const runtime = useRef({ phase: 0, elapsed: 0, last: 0, frame: 0 })
  // "Has the packet landed for this phase" — tracked here so arrival can raise
  // exactly one render instead of one per frame after arrival.
  const arrivedRef = useRef(false)

  const phases = scenario.phases
  const currentPhase = phases[Math.min(clock.phase, phases.length - 1)]
  const currentEdge = currentPhase ? EDGES_BY_ID[currentPhase.edge] : null

  /** Nodes lit so far in this run — everything the story has already reached. */
  const reached = useMemo(() => {
    const set = new Set<string>()
    const first = phases[0]
    if (first) set.add(EDGES_BY_ID[first.edge].from)
    for (let index = 0; index < clock.phase; index += 1) {
      const edge = EDGES_BY_ID[phases[index].edge]
      set.add(edge.from)
      set.add(edge.to)
    }
    if (clock.arrived && currentEdge) set.add(currentEdge.to)
    if (currentEdge) set.add(currentEdge.from)
    return set
  }, [clock.phase, clock.arrived, currentEdge, phases])

  /* --------------------------------------------------- restart on scenario */
  const restart = useCallback(() => {
    runtime.current.phase = 0
    runtime.current.elapsed = 0
    runtime.current.last = 0
    arrivedRef.current = false
    setClock({ phase: 0, progress: 0, arrived: false })
    setSelected(null)
    // Clear every lit edge so a scenario change does not inherit the last run.
    for (const path of Object.values(litRefs.current)) {
      if (!path) continue
      const length = path.getTotalLength()
      path.style.strokeDasharray = `${length}`
      path.style.strokeDashoffset = `${length}`
      path.style.opacity = '0'
    }
  }, [])

  useEffect(() => {
    restart()
  }, [scenarioId, restart])

  /* ---------------------------------------------------- visibility gating */
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting && entry.intersectionRatio > 0.25),
      { threshold: [0, 0.25, 0.6] },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const [tabVisible, setTabVisible] = useState(
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  )
  useEffect(() => {
    const update = () => setTabVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  const running = visible && tabVisible && !paused && !reducedMotion && selected === null

  /* -------------------------------------------------------- the scene clock */
  useEffect(() => {
    if (!running || phases.length === 0) return

    // Start ~300ms after the diagram becomes ready, as specified — long enough
    // to read as deliberate, short enough that nobody wonders if it is broken.
    let startDelay = runtime.current.elapsed === 0 && runtime.current.phase === 0 ? 300 : 0

    const step = (now: number) => {
      const state = runtime.current
      if (state.last === 0) state.last = now
      const delta = Math.min(now - state.last, 64) // a backgrounded tab must not jump
      state.last = now

      if (startDelay > 0) {
        startDelay -= delta
        state.frame = requestAnimationFrame(step)
        return
      }

      state.elapsed += delta
      const phase = phases[state.phase]
      const total = phase.travelMs + phase.holdMs

      // A negative elapsed is the deliberate quiet beat between runs: hold
      // everything dark rather than parking a packet at the first node.
      if (state.elapsed < 0) {
        if (packetRef.current) packetRef.current.style.opacity = '0'
        state.frame = requestAnimationFrame(step)
        return
      }

      const travelProgress = Math.min(state.elapsed / phase.travelMs, 1)

      // --- write the frame directly to the DOM -----------------------------
      const path = pathRefs.current[phase.edge]
      const lit = litRefs.current[phase.edge]
      if (path && packetRef.current) {
        const length = path.getTotalLength()
        const point = path.getPointAtLength(length * travelProgress)
        packetRef.current.style.left = pct(point.x, SCENE_WIDTH)
        packetRef.current.style.top = pct(point.y, SCENE_HEIGHT)
        packetRef.current.style.opacity = travelProgress < 1 ? '1' : '0'
      }
      if (lit) {
        const length = lit.getTotalLength()
        lit.style.strokeDasharray = `${length}`
        lit.style.strokeDashoffset = `${length * (1 - travelProgress)}`
        // The edge stays illuminated on arrival, then settles back to a trace.
        const afterArrival = state.elapsed - phase.travelMs
        lit.style.opacity =
          travelProgress < 1
            ? '1'
            : String(Math.max(0.2, 1 - afterArrival / Math.max(phase.holdMs, 1)))
      }

      // --- phase boundaries are the only thing React hears -----------------
      if (travelProgress >= 1 && !arrivedRef.current) {
        arrivedRef.current = true
        setClock({ phase: state.phase, progress: 1, arrived: true })
      }

      if (state.elapsed >= total) {
        arrivedRef.current = false
        const next = state.phase + 1
        if (next >= phases.length) {
          // One quiet second, then the story runs again from the top.
          state.phase = 0
          state.elapsed = -1000
          for (const other of Object.values(litRefs.current)) {
            if (other) other.style.opacity = '0'
          }
          setClock({ phase: 0, progress: 0, arrived: false })
        } else {
          state.elapsed = 0
          state.phase = next
          setClock({ phase: next, progress: 0, arrived: false })
        }
      }

      state.frame = requestAnimationFrame(step)
    }

    const state = runtime.current
    state.last = 0
    state.frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(state.frame)
  }, [running, phases])

  /* ------------------------------------------------------------- inspector */
  const inspectorNode = selected ? NODES_BY_ID[selected] : null
  const narration = inspectorNode?.explanation ?? currentPhase?.narration ?? ''

  const activeEdges = new Set(scenario.edges)
  const dimmedEdges = new Set(scenario.dimmed ?? [])

  /* ------------------------------------------------------ reduced motion */
  if (reducedMotion) {
    return (
      <div className={cn('space-y-4', className)}>
        <ScenarioPicker scenario={scenario} onChange={setScenarioId} />
        <StaticGraph scenario={scenario} wide={wide} />
        <ol className="space-y-2.5 rounded-[--radius-panel] border border-line bg-panel p-5">
          <p className="text-[13px] font-semibold text-text">
            {scenario.label} — step by step
          </p>
          {walkthrough(scenario).map((step, index) => (
            <li key={`${step.from}-${step.to}-${index}`} className="flex gap-3">
              <span className="tabular mt-0.5 text-2xs font-semibold text-brass-600">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                <p className="text-[13px] font-medium text-text">
                  {step.from} → {step.to}
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-text-secondary">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    )
  }

  /* --------------------------------------------------------- narrow layout */
  if (!wide) {
    return (
      <div className={cn('space-y-4', className)} ref={containerRef}>
        <ScenarioPicker scenario={scenario} onChange={setScenarioId} />
        <VerticalGraph
          scenario={scenario}
          activePhase={clock.phase}
          arrived={clock.arrived}
          onSelect={(id) => setSelected((current) => (current === id ? null : id))}
          selected={selected}
        />
        <Inspector
          text={narration}
          title={inspectorNode?.title}
          paused={paused || selected !== null}
          onResume={() => {
            setSelected(null)
            setPaused(false)
          }}
          onPause={() => setPaused(true)}
          onRestart={restart}
        />
      </div>
    )
  }

  /* ----------------------------------------------------------- wide layout */
  return (
    <div className={cn('space-y-4', className)}>
      <ScenarioPicker scenario={scenario} onChange={setScenarioId} />

      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-[--radius-showcase] border border-line bg-panel shadow-raised"
      >
        <div
          className="relative w-full"
          style={{ aspectRatio: `${SCENE_WIDTH} / ${SCENE_HEIGHT}` }}
        >
          {/* Connectors. Decorative: the same relationships are in the list below. */}
          <svg
            viewBox={`0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden
            className="absolute inset-0 size-full"
          >
            <defs>
              <linearGradient id="edge-lit" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--color-forest-300)" />
                <stop offset="100%" stopColor="var(--color-forest-500)" />
              </linearGradient>
              <filter id="packet-glow" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {EDGES.filter((edge) => activeEdges.has(edge.id)).map((edge) => {
              const dim = dimmedEdges.has(edge.id)
              return (
                <g key={edge.id}>
                  <path
                    ref={(node) => {
                      pathRefs.current[edge.id] = node
                    }}
                    d={edge.d}
                    fill="none"
                    stroke="var(--color-line-strong)"
                    strokeWidth={dim ? 1.25 : 1.75}
                    strokeDasharray={dim ? '4 6' : undefined}
                    opacity={dim ? 0.55 : 0.9}
                    strokeLinecap="round"
                  />
                  <path
                    ref={(node) => {
                      litRefs.current[edge.id] = node
                    }}
                    d={edge.d}
                    fill="none"
                    stroke="url(#edge-lit)"
                    strokeWidth="3"
                    strokeLinecap="round"
                    opacity="0"
                    style={{ transition: 'opacity 220ms linear' }}
                  />
                  {edge.label && edge.labelAt ? (
                    <text
                      x={edge.labelAt.x}
                      y={edge.labelAt.y}
                      textAnchor={edge.labelAt.anchor ?? 'middle'}
                      className="fill-[var(--color-text-muted)] text-[13px]"
                      style={{ fontSize: 13, fontWeight: 500 }}
                    >
                      {edge.label}
                    </text>
                  ) : null}
                </g>
              )
            })}
          </svg>

          {/* Nodes. Real buttons, positioned over the same coordinate space. */}
          {NODES.map((node) => (
            <NodeCard
              key={node.id}
              node={node}
              lit={reached.has(node.id)}
              arriving={clock.arrived && currentEdge?.to === node.id}
              selected={selected === node.id}
              onSelect={() =>
                setSelected((current) => {
                  const next = current === node.id ? null : node.id
                  return next
                })
              }
            />
          ))}

          {/* The travelling packet. Moved by the clock, never by React. */}
          <div
            ref={packetRef}
            aria-hidden
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-200"
          >
            <span className="flex items-center gap-1.5 rounded-full border border-forest-300 bg-forest-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-[0_0_0_4px_rgba(23,100,72,0.14)]">
              <span className="size-1.5 rounded-full bg-forest-100" />
              {currentPhase?.packet}
            </span>
          </div>
        </div>
      </div>

      <Inspector
        text={narration}
        title={inspectorNode?.title}
        paused={paused || selected !== null}
        onResume={() => {
          setSelected(null)
          setPaused(false)
        }}
        onPause={() => setPaused(true)}
        onRestart={restart}
      />
    </div>
  )
}

/* ------------------------------------------------------------------- parts */

function ScenarioPicker({
  scenario,
  onChange,
}: {
  scenario: Scenario
  onChange: (id: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="radiogroup"
        aria-label="Workflow scenario"
        className="flex flex-wrap gap-1 rounded-full border border-line bg-panel p-1 shadow-panel"
      >
        {SCENARIOS.map((entry) => {
          const active = entry.id === scenario.id
          return (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(entry.id)}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-500',
                active
                  ? 'bg-ink-800 text-text-inverse'
                  : 'text-text-secondary hover:bg-canvas-sunken hover:text-text',
              )}
            >
              {entry.label}
            </button>
          )
        })}
      </div>
      <p className="text-[13px] text-text-secondary">{scenario.summary}</p>
    </div>
  )
}

function NodeCard({
  node,
  lit,
  arriving,
  selected,
  onSelect,
}: {
  node: SceneNode
  lit: boolean
  arriving: boolean
  selected: boolean
  onSelect: () => void
}) {
  const width = node.w ?? NODE_W
  const height = node.h ?? NODE_H
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'absolute flex flex-col justify-center rounded-[--radius-panel] border px-3 text-left',
        'transition-[background-color,border-color,box-shadow,transform] duration-300',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-500',
        node.kind === 'anchor'
          ? 'border-forest-200 bg-forest-50'
          : node.kind === 'gate'
            ? 'border-line bg-panel-muted'
            : 'border-line bg-panel',
        lit && 'border-forest-300 shadow-panel',
        arriving && 'scale-[1.035] border-forest-400 shadow-raised',
        selected && 'ring-2 ring-brass-400 ring-offset-2 ring-offset-panel',
      )}
      style={{
        left: pct(node.x, SCENE_WIDTH),
        top: pct(node.y, SCENE_HEIGHT),
        width: pct(width, SCENE_WIDTH),
        height: pct(height, SCENE_HEIGHT),
      }}
    >
      <span
        className={cn(
          'truncate text-[13px] font-semibold leading-tight',
          lit ? 'text-text' : 'text-text-secondary',
        )}
      >
        {node.title}
      </span>
      <span className="truncate text-[11px] leading-tight text-text-muted">{node.detail}</span>
      {node.kind === 'anchor' && lit ? (
        <span
          aria-hidden
          className="absolute -right-1 -top-1 size-2.5 rounded-full bg-brass-500 shadow-[0_0_0_3px_var(--color-panel)]"
        />
      ) : null}
    </button>
  )
}

function Inspector({
  text,
  title,
  paused,
  onPause,
  onResume,
  onRestart,
}: {
  text: string
  title?: string
  paused: boolean
  onPause: () => void
  onResume: () => void
  onRestart: () => void
}) {
  return (
    <div className="flex flex-wrap items-start gap-4 rounded-[--radius-panel] border border-line bg-panel px-4 py-3.5 shadow-panel">
      <div className="min-w-0 flex-1">
        {title ? (
          <p className="text-[13px] font-semibold text-text">
            {title}
            <span className="ml-2 font-normal text-text-muted">· story paused</span>
          </p>
        ) : null}
        {/*
          Not a live region: announcing every animation tick would make the page
          hostile to a screen reader. The full ordered walkthrough is available
          under reduced motion, which is where an assistive reading belongs.
        */}
        <p className="text-[13px] leading-relaxed text-text-secondary">{text}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex size-9 items-center justify-center rounded-[--radius-control] text-text-secondary transition-colors hover:bg-canvas-sunken hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-500"
          aria-label="Play the story from the beginning"
          title="Play from the beginning"
        >
          <RotateCcw className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={paused ? onResume : onPause}
          className="inline-flex h-9 items-center gap-1.5 rounded-[--radius-control] border border-line-strong bg-panel px-3 text-[13px] font-semibold text-text transition-colors hover:bg-canvas-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-500"
        >
          {paused ? (
            <>
              <Play className="size-3.5" aria-hidden /> Resume
            </>
          ) : (
            <>
              <Pause className="size-3.5" aria-hidden /> Pause
            </>
          )}
        </button>
      </div>
    </div>
  )
}

/** A vertical rail for narrow screens: fewer labels, one column, still animated. */
function VerticalGraph({
  scenario,
  activePhase,
  arrived,
  selected,
  onSelect,
}: {
  scenario: Scenario
  activePhase: number
  arrived: boolean
  selected: string | null
  onSelect: (id: string) => void
}) {
  // The vertical story is the sequence of destinations, which reads naturally
  // as a list and avoids a miniature version of the desktop canvas.
  const steps = scenario.phases.map((phase, index) => ({
    index,
    node: NODES_BY_ID[EDGES_BY_ID[phase.edge].to],
    packet: phase.packet,
  }))

  return (
    <ol className="relative space-y-2 rounded-[--radius-panel] border border-line bg-panel p-4 shadow-panel">
      {steps.map((step, index) => {
        const done = index < activePhase || (index === activePhase && arrived)
        const active = index === activePhase
        return (
          <li key={`${step.node.id}-${index}`} className="relative flex gap-3 pl-1">
            {index < steps.length - 1 ? (
              <span
                aria-hidden
                className={cn(
                  'absolute left-[13px] top-7 h-[calc(100%-0.5rem)] w-0.5 rounded-full transition-colors duration-500',
                  done ? 'bg-forest-300' : 'bg-line',
                )}
              />
            ) : null}
            <span
              aria-hidden
              className={cn(
                'relative z-10 mt-1 flex size-[26px] shrink-0 items-center justify-center rounded-full border text-[10px] font-bold transition-all duration-300',
                done
                  ? 'border-forest-400 bg-forest-500 text-white'
                  : active
                    ? 'border-forest-300 bg-forest-50 text-forest-700'
                    : 'border-line bg-panel text-text-muted',
              )}
            >
              {index + 1}
            </span>
            <button
              type="button"
              onClick={() => onSelect(step.node.id)}
              className={cn(
                'min-w-0 flex-1 rounded-[--radius-control] px-2.5 py-2 text-left transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-500',
                active && 'bg-forest-50',
                selected === step.node.id && 'ring-2 ring-brass-400',
              )}
            >
              <span className="block text-[13px] font-semibold text-text">{step.node.title}</span>
              <span className="block text-[11px] text-text-muted">
                {active ? step.packet : step.node.detail}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/** The complete, connected, motionless graph shown under reduced motion. */
function StaticGraph({ scenario, wide }: { scenario: Scenario; wide: boolean }) {
  if (!wide) return null
  const active = new Set(scenario.edges)
  const dimmed = new Set(scenario.dimmed ?? [])
  return (
    <div className="relative w-full overflow-hidden rounded-[--radius-showcase] border border-line bg-panel shadow-panel">
      <div className="relative w-full" style={{ aspectRatio: `${SCENE_WIDTH} / ${SCENE_HEIGHT}` }}>
        <svg
          viewBox={`0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`}
          aria-hidden
          className="absolute inset-0 size-full"
        >
          <defs>
            <marker id="static-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--color-forest-500)" />
            </marker>
          </defs>
          {EDGES.filter((edge) => active.has(edge.id)).map((edge) => (
            <path
              key={edge.id}
              d={edge.d}
              fill="none"
              stroke={dimmed.has(edge.id) ? 'var(--color-line-strong)' : 'var(--color-forest-500)'}
              strokeWidth={dimmed.has(edge.id) ? 1.25 : 1.75}
              strokeDasharray={dimmed.has(edge.id) ? '4 6' : undefined}
              markerEnd={dimmed.has(edge.id) ? undefined : 'url(#static-arrow)'}
              opacity={dimmed.has(edge.id) ? 0.5 : 0.85}
            />
          ))}
        </svg>
        {NODES.map((node) => (
          <div
            key={node.id}
            className={cn(
              'absolute flex flex-col justify-center rounded-[--radius-panel] border px-3',
              node.kind === 'anchor' ? 'border-forest-200 bg-forest-50' : 'border-line bg-panel',
            )}
            style={{
              left: pct(node.x, SCENE_WIDTH),
              top: pct(node.y, SCENE_HEIGHT),
              width: pct(node.w ?? NODE_W, SCENE_WIDTH),
              height: pct(node.h ?? NODE_H, SCENE_HEIGHT),
            }}
          >
            <span className="truncate text-[13px] font-semibold text-text">{node.title}</span>
            <span className="truncate text-[11px] text-text-muted">{node.detail}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
