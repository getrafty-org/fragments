import { performance } from 'perf_hooks'

export interface MetricSample {
  time: number
  value: number
}

export interface AggregatorInstance {
  add(sample: MetricSample): void
  prune(cutoffTime: number): void
  value(): number
}

export interface AggregationDefinition {
  id: string
  label: string
  createInstance(windowMs: number): AggregatorInstance
}

export interface UnitDefinition {
  id: string
  normalize(value: number): number
  denormalize(value: number): number
  format(value: number): string
  axisLabel(value: number): string
}

export interface MetricConfig {
  key: string
  label?: string
  unit: string
  aggregations?: readonly string[]
}

export interface BenchmarkConfigInput {
  metrics: MetricConfig[]
  historySize?: number
  refreshIntervalMs?: number
  windowSizeMs?: number
  yAxisWidth?: number
  chartWidth?: number
  chartHeight?: number
  aggregations?: Record<string, AggregationDefinition>
  units?: Record<string, UnitDefinition>
  countAggregation?: string
  highlightColor?: string
}

export interface ResolvedMetricConfig {
  key: string
  label: string
  unitKey: string
  unit: UnitDefinition
  aggregationIds: string[]
}

export interface BenchmarkConfig {
  metrics: ResolvedMetricConfig[]
  aggregations: Record<string, AggregationDefinition>
  units: Record<string, UnitDefinition>
  countAggregation?: string
  historySize: number
  refreshIntervalMs: number
  windowSizeMs: number
  yAxisWidth: number
  chartWidth: number
  chartHeight: number
  highlightColor?: string
}

export interface MetricSnapshot extends Record<string, number> {
  time: number
}

export interface ChartSlot {
  metric: string
  aggregation: string
}

export interface DisplayOptions {
  slots?: ChartSlot[]
  header?: () => string[]
  highlightColor?: string
}

export class Metrics {
  private readonly aggregatorInstances: Record<string, Record<string, AggregatorInstance>> = {}
  private readonly history: Record<string, MetricSnapshot[]> = {}

  constructor(private readonly config: BenchmarkConfig) {
    for (const metric of config.metrics) {
      const instances: Record<string, AggregatorInstance> = {}
      for (const aggId of metric.aggregationIds) {
        const def = config.aggregations[aggId]
        instances[aggId] = def.createInstance(config.windowSizeMs)
      }
      this.aggregatorInstances[metric.key] = instances
      this.history[metric.key] = []
    }
  }

  addSample(metricKey: string, value: number): void {
    const sample: MetricSample = { time: Date.now(), value }
    const instances = this.aggregatorInstances[metricKey]
    if (!instances) return
    Object.values(instances).forEach(instance => instance.add(sample))
  }

  capture(): Record<string, Record<string, number>> {
    const stats: Record<string, Record<string, number>> = {}
    const now = Date.now()
    const cutoff = now - this.config.windowSizeMs

    for (const metric of this.config.metrics) {
      const instances = this.aggregatorInstances[metric.key]
      const snapshot: Record<string, number> = {}
      for (const aggId of metric.aggregationIds) {
        const instance = instances[aggId]
        instance.prune(cutoff)
        snapshot[aggId] = instance.value()
      }
      stats[metric.key] = snapshot
      const history = this.history[metric.key]
      history.push({ time: now, ...snapshot })
      if (history.length > this.config.historySize) {
        history.shift()
      }
    }

    return stats
  }

  getHistory(metricKey: string): MetricSnapshot[] {
    return this.history[metricKey]
  }
}

abstract class QueueAggregator implements AggregatorInstance {
  protected samples: MetricSample[] = []

  add(sample: MetricSample): void {
    this.samples.push(sample)
    this.onAdd(sample)
  }

  prune(cutoffTime: number): void {
    while (this.samples.length && this.samples[0].time < cutoffTime) {
      const expired = this.samples.shift()!
      this.onRemove(expired)
    }
  }

  protected abstract onAdd(sample: MetricSample): void
  protected abstract onRemove(sample: MetricSample): void
  abstract value(): number
}

class SumAggregator extends QueueAggregator {
  private sum = 0
  protected onAdd(sample: MetricSample): void {
    this.sum += sample.value
  }
  protected onRemove(sample: MetricSample): void {
    this.sum -= sample.value
  }
  value(): number {
    return this.sum
  }
}

class CountAggregator extends QueueAggregator {
  private count = 0
  protected onAdd(_: MetricSample): void {
    this.count += 1
  }
  protected onRemove(_: MetricSample): void {
    this.count = Math.max(0, this.count - 1)
  }
  value(): number {
    return this.count
  }
}

class AverageAggregator extends QueueAggregator {
  private sum = 0
  private count = 0
  protected onAdd(sample: MetricSample): void {
    this.sum += sample.value
    this.count += 1
  }
  protected onRemove(sample: MetricSample): void {
    this.sum -= sample.value
    this.count = Math.max(0, this.count - 1)
  }
  value(): number {
    return this.count === 0 ? 0 : this.sum / this.count
  }
}

class StdDevAggregator extends QueueAggregator {
  private sum = 0
  private sumSquares = 0
  private count = 0
  protected onAdd(sample: MetricSample): void {
    this.sum += sample.value
    this.sumSquares += sample.value * sample.value
    this.count += 1
  }
  protected onRemove(sample: MetricSample): void {
    this.sum -= sample.value
    this.sumSquares -= sample.value * sample.value
    this.count = Math.max(0, this.count - 1)
  }
  value(): number {
    if (this.count <= 1) return 0
    const mean = this.sum / this.count
    const variance = (this.sumSquares / this.count) - mean * mean
    return Math.sqrt(Math.max(variance, 0))
  }
}

class MinAggregator extends QueueAggregator {
  private deque: MetricSample[] = []
  protected onAdd(sample: MetricSample): void {
    while (this.deque.length && this.deque[this.deque.length - 1].value > sample.value) {
      this.deque.pop()
    }
    this.deque.push(sample)
  }
  protected onRemove(sample: MetricSample): void {
    if (this.deque.length && this.deque[0] === sample) {
      this.deque.shift()
    }
  }
  value(): number {
    return this.deque.length ? this.deque[0].value : 0
  }
}

class MaxAggregator extends QueueAggregator {
  private deque: MetricSample[] = []
  protected onAdd(sample: MetricSample): void {
    while (this.deque.length && this.deque[this.deque.length - 1].value < sample.value) {
      this.deque.pop()
    }
    this.deque.push(sample)
  }
  protected onRemove(sample: MetricSample): void {
    if (this.deque.length && this.deque[0] === sample) {
      this.deque.shift()
    }
  }
  value(): number {
    return this.deque.length ? this.deque[0].value : 0
  }
}

class RateAggregator extends SumAggregator {
  constructor(private readonly windowMs: number) {
    super()
  }
  value(): number {
    if (this.windowMs <= 0) return 0
    return super.value() / (this.windowMs / 1000)
  }
}

class PercentileAggregator extends QueueAggregator {
  private counts = new Map<number, number>()
  private values: number[] = []
  private total = 0

  constructor(private readonly quantile: number) {
    super()
  }

  protected onAdd(sample: MetricSample): void {
    this.insertValue(sample.value)
    this.total += 1
  }

  protected onRemove(sample: MetricSample): void {
    this.removeValue(sample.value)
    this.total = Math.max(0, this.total - 1)
  }

  value(): number {
    if (this.total === 0) return 0
    const target = Math.max(0, Math.ceil(this.quantile * this.total) - 1)
    let cumulative = 0
    for (const value of this.values) {
      const count = this.counts.get(value) ?? 0
      if (cumulative + count > target) {
        return value
      }
      cumulative += count
    }
    return this.values[this.values.length - 1]
  }

  private insertValue(value: number): void {
    const index = lowerBound(this.values, value)
    if (index < this.values.length && this.values[index] === value) {
      this.counts.set(value, (this.counts.get(value) ?? 0) + 1)
    } else {
      this.values.splice(index, 0, value)
      this.counts.set(value, 1)
    }
  }

  private removeValue(value: number): void {
    const index = lowerBound(this.values, value)
    if (index >= this.values.length || this.values[index] !== value) return
    const current = this.counts.get(value) ?? 0
    if (current <= 1) {
      this.counts.delete(value)
      this.values.splice(index, 1)
    } else {
      this.counts.set(value, current - 1)
    }
  }
}

class TerminalChart {
  private charWidth: number
  private pixelWidth: number
  private readonly pixelHeight: number
  private readonly brailleBase = 0x2800

  constructor(width = 60, height = 8) {
    this.charWidth = Math.max(1, width)
    this.pixelWidth = this.charWidth * 2
    this.pixelHeight = Math.max(1, height) * 4
  }

  updateWidth(width: number): void {
    this.charWidth = Math.max(1, width)
    this.pixelWidth = this.charWidth * 2
  }

  render(
    snapshots: MetricSnapshot[],
    metricLabel: string,
    aggregationLabel: string,
    aggregationId: string,
    yAxisWidth: number,
    unit: UnitDefinition,
    windowMs: number,
    countValue?: number
  ): string[] {
    if (snapshots.length === 0) {
      return [`${metricLabel} ${aggregationLabel}: no data`]
    }

    const baseValues = snapshots
      .map(snapshot => snapshot[aggregationId])
      .filter((value): value is number => typeof value === 'number')
    if (baseValues.length === 0) {
      return [`${metricLabel} ${aggregationLabel}: no data`]
    }

    const plotWidth = this.charWidth
    const baseRecent = baseValues.slice(-plotWidth)
    const normalizedRecent = baseRecent.map(value => unit.normalize(value))
    const minNorm = Math.min(...normalizedRecent)
    const maxNorm = Math.max(...normalizedRecent)
    const rangeNorm = maxNorm - minNorm || 1

    const minBase = unit.denormalize(minNorm)
    const maxBase = unit.denormalize(maxNorm)
    const midBase = unit.denormalize(minNorm + rangeNorm / 2)
    const currentBase = baseRecent[baseRecent.length - 1] ?? 0

    const title = truncate(
      `${metricLabel} ${aggregationLabel}: ${unit.format(currentBase)}`,
      yAxisWidth + 1 + plotWidth
    )

    const canvas = Array(this.pixelHeight / 4)
      .fill(0)
      .map(() => Array(plotWidth).fill(0))

    for (let i = 1; i < normalizedRecent.length; i++) {
      const x1 = i - 1
      const y1 = Math.floor(((maxNorm - normalizedRecent[i - 1]) / rangeNorm) * (this.pixelHeight - 1))
      const x2 = i
      const y2 = Math.floor(((maxNorm - normalizedRecent[i]) / rangeNorm) * (this.pixelHeight - 1))
      this.drawLine(canvas, x1, y1, x2, y2)
    }

    const maxLineLength = yAxisWidth + 1 + plotWidth
    const lines: string[] = []
    const maxLabel = unit.axisLabel(maxBase)
    const minLabel = unit.axisLabel(minBase)
    const midLabel = unit.axisLabel(midBase)

    for (let row = 0; row < canvas.length; row++) {
      let line = ''
      for (let col = 0; col < canvas[row].length; col++) {
        const dots = canvas[row][col]
        line += dots === 0 ? ' ' : String.fromCharCode(this.brailleBase + dots)
      }
      const midRow = Math.floor(canvas.length / 2)
      const yLabel = row === 0 ? maxLabel : row === canvas.length - 1 ? minLabel : row === midRow ? midLabel : ''
      lines.push(truncate(`${yLabel.padStart(yAxisWidth)}│${line}`, maxLineLength))
    }

    const axisLine = truncate(`${' '.repeat(yAxisWidth)}└${'─'.repeat(plotWidth)}┘`, maxLineLength)
    const timeLabel = truncate(`${' '.repeat(yAxisWidth + 1)}window ${formatDuration(windowMs)}`, maxLineLength)

    return [title, ...lines, axisLine, timeLabel, '']
  }

  private drawLine(canvas: number[][], x0: number, y0: number, x1: number, y1: number): void {
    const dx = Math.abs(x1 - x0)
    const dy = Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx - dy
    let x = x0
    let y = y0

    while (true) {
      if (x >= 0 && x < this.pixelWidth && y >= 0 && y < this.pixelHeight) {
        const canvasRow = Math.floor(y / 4)
        const canvasCol = Math.floor(x / 2)
        const dotRow = y % 4
        const dotCol = x % 2
        if (canvasRow < canvas.length && canvasCol < canvas[canvasRow].length) {
          const brailleDots = [
            [0x01, 0x08],
            [0x02, 0x10],
            [0x04, 0x20],
            [0x40, 0x80]
          ]
          canvas[canvasRow][canvasCol] |= brailleDots[dotRow][dotCol]
        }
      }
      if (x === x1 && y === y1) break
      const e2 = 2 * err
      if (e2 > -dy) {
        err -= dy
        x += sx
      }
      if (e2 < dx) {
        err += dx
        y += sy
      }
    }
  }
}

export class Plot {
  private chart: TerminalChart
  private lineWidth: number
  private running = true
  private slots: ChartSlot[]
  private activeSlot = 0
  private metricIndex = 0
  private aggIndex = 0
  private timer: NodeJS.Timeout | null = null

  private readonly metrics: ResolvedMetricConfig[]
  private readonly aggregationLabels: Record<string, string>
  private readonly highlightColor: string

  constructor(private readonly config: BenchmarkConfig, private readonly options: DisplayOptions = {}) {
    this.metrics = config.metrics
    this.lineWidth = config.chartWidth
    this.chart = new TerminalChart(config.chartWidth, config.chartHeight)
    this.highlightColor = options.highlightColor ?? config.highlightColor ?? '\x1b[34m'

    this.slots = options.slots ?? this.createDefaultSlots()
    this.aggregationLabels = {}
    for (const metric of config.metrics) {
      for (const aggId of metric.aggregationIds) {
        if (!this.aggregationLabels[aggId]) {
          this.aggregationLabels[aggId] = config.aggregations[aggId].label
        }
      }
    }
  }

  async start(metrics: Metrics): Promise<void> {
    console.clear()
    process.stdout.write('\x1b[?25l')

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
      process.stdin.resume()
      process.stdin.on('data', (key) => {
        const k = key.toString()
        if (k === '\u0003') {
          this.stop()
          return
        }
        this.handleKey(k)
      })
    }

    const tick = () => {
      metrics.capture()
      this.render(metrics)
    }

    this.timer = setInterval(() => {
      if (!this.running) return
      tick()
    }, this.config.refreshIntervalMs)

    tick()
  }

  render(metrics: Metrics): void {
    process.stdout.write('\x1b[H')
    const terminalWidth = Math.max(40, process.stdout.columns ?? (this.lineWidth * 2))
    const columns = Math.min(2, Math.max(1, this.slots.length))
    const availableWidth = terminalWidth - columns * (this.config.yAxisWidth + 2)
    const targetWidth = Math.max(20, Math.min(this.config.chartWidth, Math.floor(availableWidth / columns)))

    if (targetWidth !== this.lineWidth) {
      this.lineWidth = targetWidth
      this.chart = new TerminalChart(this.lineWidth, this.config.chartHeight)
    } else {
      this.chart.updateWidth(this.lineWidth)
    }

    const headerLines = this.options.header ? this.options.header() : []
    headerLines.forEach(line => console.log(truncate(line, terminalWidth)))
    if (headerLines.length > 0) {
      console.log(truncate('─'.repeat(terminalWidth), terminalWidth))
      console.log()
    }

    const panels = this.slots.map(slot => {
      const metric = this.metrics.find(m => m.key === slot.metric)
      if (!metric) return ['metric not found']
      const snapshots = metrics.getHistory(metric.key)
      const aggregationLabel = this.aggregationLabels[slot.aggregation] ?? slot.aggregation
      const countAggregation = this.config.countAggregation
      const latest = snapshots[snapshots.length - 1]
      const countValue = countAggregation && latest ? latest[countAggregation] : undefined
      return this.chart.render(
        snapshots,
        metric.label,
        aggregationLabel,
        slot.aggregation,
        this.config.yAxisWidth,
        metric.unit,
        this.config.windowSizeMs,
        typeof countValue === 'number' ? countValue : undefined
      )
    })

    const panelWidths = panels.map(lines => lines.reduce((max, line) => Math.max(max, line.length), 0))
    const rows = Math.ceil(this.slots.length / columns)

    for (let row = 0; row < rows; row++) {
      const start = row * columns
      const rowPanels = panels.slice(start, start + columns)
      const rowWidths = panelWidths.slice(start, start + columns)
      const rowHeight = Math.max(...rowPanels.map(lines => lines.length))
      rowPanels.forEach((lines, idx) => {
        while (lines.length < rowHeight) {
          const width = Math.max(rowWidths[idx] ?? this.lineWidth, this.lineWidth)
          lines.push(' '.repeat(width))
        }
      })
      for (let lineIndex = 0; lineIndex < rowHeight; lineIndex++) {
        const segments = rowPanels.map((lines, colIdx) => {
          const slotIndex = start + colIdx
          const width = Math.max(rowWidths[colIdx] ?? this.lineWidth, this.lineWidth)
          return this.formatChartLine(lines[lineIndex], slotIndex, width)
        })
        console.log(truncate(segments.join(''), terminalWidth))
      }
      if (row < rows - 1) {
        console.log()
      }
    }

    console.log()
    const activeSlot = this.slots[this.activeSlot]
    const metricLabel = this.metrics.find(m => m.key === activeSlot.metric)?.label ?? activeSlot.metric
    const aggregationLabel = this.aggregationLabels[activeSlot.aggregation] ?? activeSlot.aggregation
    console.log(truncate(`[1-${this.slots.length}] slot | [j/k] metric (${metricLabel}) | [h/l] agg (${aggregationLabel}) | [q] quit`, terminalWidth))
  }

  isRunning(): boolean {
    return this.running
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false)
      process.stdin.pause()
    }
    process.stdout.write('\x1b[2J\x1b[H')
    process.stdout.write('\x1b[?25h')
  }

  private formatChartLine(line: string, slotIndex: number, width: number): string {
    const formatted = line.length > width ? line.substring(0, width) : line.padEnd(width)
    if (slotIndex === this.activeSlot) {
      return `${this.highlightColor}${formatted}\x1b[0m`
    }
    return formatted
  }

  private handleKey(key: string): void {
    if (key === 'q') {
      this.stop()
      return
    }
    const slotIndex = parseInt(key, 10)
    if (!Number.isNaN(slotIndex) && slotIndex >= 1 && slotIndex <= this.slots.length) {
      this.activeSlot = slotIndex - 1
      this.syncCursor()
      return
    }
    if (key === 'j') {
      this.metricIndex = (this.metricIndex + 1) % this.metrics.length
      this.aggIndex = 0
      this.updateActiveSlot()
    }
    if (key === 'k') {
      this.metricIndex = (this.metricIndex - 1 + this.metrics.length) % this.metrics.length
      this.aggIndex = 0
      this.updateActiveSlot()
    }
    if (key === 'l') {
      const currentMetric = this.metrics[this.metricIndex]
      const aggCount = currentMetric.aggregationIds.length
      if (aggCount > 0) {
        this.aggIndex = (this.aggIndex + 1) % aggCount
        this.updateActiveSlot()
      }
    }
    if (key === 'h') {
      const currentMetric = this.metrics[this.metricIndex]
      const aggCount = currentMetric.aggregationIds.length
      if (aggCount > 0) {
        this.aggIndex = (this.aggIndex - 1 + aggCount) % aggCount
        this.updateActiveSlot()
      }
    }
  }

  private updateActiveSlot(): void {
    const metric = this.metrics[this.metricIndex]
    const aggregation = metric.aggregationIds[this.aggIndex] ?? metric.aggregationIds[0]
    this.slots[this.activeSlot] = { metric: metric.key, aggregation }
  }

  private syncCursor(): void {
    const active = this.slots[this.activeSlot]
    this.metricIndex = this.metrics.findIndex(m => m.key === active.metric)
    if (this.metricIndex === -1) this.metricIndex = 0
    const metric = this.metrics[this.metricIndex]
    const aggIdx = metric.aggregationIds.indexOf(active.aggregation)
    this.aggIndex = aggIdx === -1 ? 0 : aggIdx
  }

  private createDefaultSlots(): ChartSlot[] {
    const slots: ChartSlot[] = []
    for (const metric of this.metrics) {
      const firstAgg = metric.aggregationIds[0]
      if (firstAgg) {
        slots.push({ metric: metric.key, aggregation: firstAgg })
      }
      if (slots.length >= 4) break
    }
    return slots.length > 0 ? slots : [{ metric: this.metrics[0].key, aggregation: this.metrics[0].aggregationIds[0] }]
  }
}

export function resolveBenchmarkConfig(config: BenchmarkConfigInput): BenchmarkConfig {
  const historySize = config.historySize ?? 100
  const refreshIntervalMs = config.refreshIntervalMs ?? 500
  const windowSizeMs = config.windowSizeMs ?? 1000
  const yAxisWidth = config.yAxisWidth ?? 9
  const chartWidth = config.chartWidth ?? 60
  const chartHeight = config.chartHeight ?? 8

  const aggregatorMap = { ...DEFAULT_AGGREGATIONS, ...(config.aggregations ?? {}) }
  const unitMap = { ...DEFAULT_UNITS, ...(config.units ?? {}) }

  const resolvedMetrics: ResolvedMetricConfig[] = config.metrics.map(metric => {
    const key = metric.key
    const label = metric.label ?? humanizeMetricKey(metric.key)
    const unitKey = metric.unit
    const unit = unitMap[unitKey] ?? DEFAULT_UNITS[unitKey]
    if (!unit) {
      throw new Error(`Metric '${key}' references unknown unit '${unitKey}'.`)
    }

    const rawAggregations = metric.aggregations ?? DEFAULT_AGGREGATION_KEYS
    const aggregationIds = Array.from(new Set(rawAggregations)).filter(id => aggregatorMap[id])
    if (aggregationIds.length === 0) {
      throw new Error(`Metric '${key}' has no valid aggregations configured.`)
    }

    return {
      key,
      label,
      unitKey,
      unit,
      aggregationIds
    }
  })

  const countAggregation = config.countAggregation
    ? config.countAggregation
    : resolvedMetrics.some(metric => metric.aggregationIds.includes('count'))
      ? 'count'
      : undefined

  return {
    metrics: resolvedMetrics,
    aggregations: aggregatorMap,
    units: unitMap,
    countAggregation,
    historySize,
    refreshIntervalMs,
    windowSizeMs,
    yAxisWidth,
    chartWidth,
    chartHeight,
    highlightColor: config.highlightColor
  }
}

export function averageAggregation(id: string, label = id): AggregationDefinition {
  return {
    id,
    label,
    createInstance: () => new AverageAggregator()
  }
}

export function percentileAggregation(id: string, label: string, quantile: number): AggregationDefinition {
  const clamped = Math.min(Math.max(quantile, 0), 1)
  return {
    id,
    label,
    createInstance: () => new PercentileAggregator(clamped)
  }
}

export function stddevAggregation(id: string, label = id): AggregationDefinition {
  return {
    id,
    label,
    createInstance: () => new StdDevAggregator()
  }
}

export function sumAggregation(id: string, label = id): AggregationDefinition {
  return {
    id,
    label,
    createInstance: () => new SumAggregator()
  }
}

export function countAggregation(id: string, label = id): AggregationDefinition {
  return {
    id,
    label,
    createInstance: () => new CountAggregator()
  }
}

export function minAggregation(id: string, label = id): AggregationDefinition {
  return {
    id,
    label,
    createInstance: () => new MinAggregator()
  }
}

export function maxAggregation(id: string, label = id): AggregationDefinition {
  return {
    id,
    label,
    createInstance: () => new MaxAggregator()
  }
}

export function rateAggregation(id: string, label = id): AggregationDefinition {
  return {
    id,
    label,
    createInstance: (windowMs: number) => new RateAggregator(windowMs)
  }
}

export interface CountUnitOptions {
  suffix?: string
  decimals?: number
}

export function countUnit(id: string, options: CountUnitOptions = {}): UnitDefinition {
  const suffix = options.suffix ?? ''
  const decimals = options.decimals ?? 0
  return {
    id,
    normalize: value => value,
    denormalize: value => value,
    format: value => `${formatNumber(value, decimals)}${suffix ? ` ${suffix}` : ''}`,
    axisLabel: value => `${formatNumber(value, decimals)}${suffix ? ` ${suffix}` : ''}`
  }
}

export function timeUnit(id: string): UnitDefinition {
  return {
    id,
    normalize: value => value,
    denormalize: value => value,
    format: value => formatDurationValue(value),
    axisLabel: value => formatDurationValue(value)
  }
}

export function sizeUnit(id: string): UnitDefinition {
  return {
    id,
    normalize: value => value,
    denormalize: value => value,
    format: value => formatSize(value),
    axisLabel: value => formatSize(value)
  }
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return '0 ms'
  return formatDurationValue(ms)
}

const DEFAULT_AGGREGATIONS: Record<string, AggregationDefinition> = {
  avg: averageAggregation('avg', 'avg'),
  p50: percentileAggregation('p50', 'p50', 0.5),
  p90: percentileAggregation('p90', 'p90', 0.9),
  p99: percentileAggregation('p99', 'p99', 0.99),
  std: stddevAggregation('std', 'std'),
  sum: sumAggregation('sum', 'sum'),
  count: countAggregation('count', 'count'),
  min: minAggregation('min', 'min'),
  max: maxAggregation('max', 'max'),
  rate: rateAggregation('rate', 'rate')
}

export type AggregationId = keyof typeof DEFAULT_AGGREGATIONS

const DEFAULT_AGGREGATION_KEYS: readonly AggregationId[] = ['avg', 'p50', 'p90', 'p99', 'min', 'max', 'std', 'sum', 'count']

export const AGGREGATION_GROUPS = {
  PERCENTILES: ['p50', 'p90', 'p99'],
  EXTREMES: ['min', 'max'],
  DISTRIBUTION: ['avg', 'p50', 'p90', 'p99', 'min', 'max'],
  SUMMARY: ['avg', 'sum', 'count'],
  THROUGHPUT: ['rate', 'count'],
  ALL: ['avg', 'p50', 'p90', 'p99', 'min', 'max', 'std', 'sum', 'count', 'rate']
} satisfies Record<string, readonly AggregationId[]>

const DEFAULT_UNITS: Record<string, UnitDefinition> = {
  time: timeUnit('time'),
  size: sizeUnit('size'),
  count: countUnit('count')
}

function truncate(text: string, width: number): string {
  if (text.length <= width) return text
  if (width <= 1) return width === 1 ? '…' : ''
  return text.slice(0, width - 1) + '…'
}

function lowerBound(array: number[], value: number): number {
  let low = 0
  let high = array.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (array[mid] < value) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low
}

function formatNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '0'
  const fixed = value.toFixed(decimals)
  return decimals > 0 ? fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') : fixed
}

function formatDurationValue(ms: number): string {
  const abs = Math.abs(ms)
  if (abs < 1) {
    return `${formatNumber(ms * 1000, 2)} µs`
  }
  if (abs < 1000) {
    return `${formatNumber(ms, ms < 10 ? 2 : 1)} ms`
  }
  const seconds = ms / 1000
  if (Math.abs(seconds) < 60) {
    return `${formatNumber(seconds, Math.abs(seconds) < 10 ? 2 : 1)} s`
  }
  const minutes = seconds / 60
  if (Math.abs(minutes) < 60) {
    return `${formatNumber(minutes, Math.abs(minutes) < 10 ? 2 : 1)} min`
  }
  const hours = minutes / 60
  return `${formatNumber(hours, Math.abs(hours) < 10 ? 2 : 1)} h`
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes)) return '0 B'
  const abs = Math.abs(bytes)
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let value = abs
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  const formatted = formatNumber(value * Math.sign(bytes), value < 10 ? 2 : value < 100 ? 1 : 0)
  return `${formatted} ${units[index]}`
}

function humanizeMetricKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^./, s => s.toUpperCase())
}

export async function timeOperation(fn: () => Promise<void>): Promise<number> {
  const start = performance.now()
  await fn()
  return performance.now() - start
}

export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

