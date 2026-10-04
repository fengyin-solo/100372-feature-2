import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionContext,
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  SearchSummary,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 站点检索支持的条件：沿「站点编号 → 所在河流 → 运行状态」这条检索链路。
const STATION_FILTER_FIELDS = ['站点编号', '所在河流', '运行状态']
// 旧参数归一：老页面/书签里可能带这些字段名，统一映射到现在的条件上。
const STATION_ALIASES: Record<string, string> = {
  状态: '运行状态',
  status: '运行状态',
  站点状态: '运行状态',
  code: '站点编号',
  river: '所在河流',
}
const PAGE_SIZE_DEFAULT = 5

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

function cleanFilters(filters: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(filters)
      .map(([field, value]) => [field, String(value ?? '').trim()])
      .filter(([, value]) => value !== ''),
  )
}

/**
 * 站点检索参数归一化：
 * - 旧字段名（状态/status/站点状态、code、river）兼容到新条件；
 * - 新条件与旧参数同时出现时，以新条件为准（筛选冲突时优先显式新参数）。
 */
export function normalizeStationFilters(filters: Record<string, string>): Record<string, string> {
  const cleaned = cleanFilters(filters)
  const normalized: Record<string, string> = {}
  for (const [rawField, value] of Object.entries(cleaned)) {
    const field = STATION_ALIASES[rawField] ?? rawField
    if (field === '运行状态' || field === '站点编号' || field === '所在河流') {
      if (normalized[field] === undefined) {
        normalized[field] = value
      }
      continue
    }
    // 旧版支持的其他条件（站点名称、站点类型等）继续保留，按模糊匹配走。
    if (normalized[field] === undefined) {
      normalized[field] = value
    }
  }
  return normalized
}

function matchStation(row: EntryRow, field: string, value: string, meta: ModuleMeta): boolean {
  if (field === '运行状态') {
    // 状态条件优先对照规范状态列；命中规范状态名时按严格等值判断。
    if (meta.statuses.includes(value) || String(row.status) === value) {
      return String(row.status) === value
    }
    // 旧数据把业务状态写在「运行状态」列里时，退回到该列做模糊匹配。
    return String(row[field] ?? '').includes(value)
  }
  const cell = String(row[field] ?? '')
  return cell.includes(value)
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(cleanFilters(filters))
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value)),
  )
}

/** 站点专用筛选：旧参数先归一，状态条件按规范状态列优先判定。 */
export function filterStationRows(
  rows: EntryRow[],
  filters: Record<string, string>,
): EntryRow[] {
  const normalized = normalizeStationFilters(filters)
  const pairs = Object.entries(normalized)
  if (pairs.length === 0) {
    return rows
  }
  const meta = moduleMeta('station')
  return rows.filter((row) =>
    pairs.every(([field, value]) => matchStation(row, field, value, meta)),
  )
}

/** 命中摘要：每个条件单独计数，便于在条件冲突（合计有数据但交集为 0）时定位原因。 */
export function stationSearchSummary(
  filters: Record<string, string>,
  rows: EntryRow[] = listRows('station'),
): SearchSummary {
  const normalized = normalizeStationFilters(filters)
  const meta = moduleMeta('station')
  return {
    total: rows.length,
    matched: filterStationRows(rows, normalized).length,
    active: Object.entries(normalized).map(([field, value]) => ({
      field,
      value,
      count: rows.filter((row) => matchStation(row, field, value, meta)).length,
    })),
  }
}

export type ListOptions = {
  page?: number
  size?: number
}

export function listEntries(
  key: string,
  filters: Record<string, string> = {},
  options: ListOptions = {},
): PageResult {
  const all = listRows(key)
  const matched = key === 'station' ? filterStationRows(all, filters) : filterRows(all, filters)

  // 不传分页：保持旧契约，整页返回（兼容既有页面）。
  if (options.size === undefined && options.page === undefined) {
    return { items: matched, total: matched.length, page: 1, size: matched.length }
  }

  const size = Math.max(1, options.size ?? PAGE_SIZE_DEFAULT)
  const pageCount = Math.max(1, Math.ceil(matched.length / size))
  const requested = Number(options.page ?? 1)
  // 翻页越界（非正整数或超出总页数）一律回第 1 页。
  const validPage = Number.isInteger(requested) && requested >= 1 && requested <= pageCount
  const page = validPage ? requested : 1
  const start = (page - 1) * size
  return {
    items: matched.slice(start, start + size),
    total: matched.length,
    page,
    size,
    clamped: !validPage,
  }
}

// 重复提交台账：同主体同动作只保留首份结果；主体状态被其他动作改变后失效。
const actionLedger = new Map<string, ActionResult>()

function ledgerKey(key: string, id: number, action: string): string {
  return `${key}#${id}#${action}`
}

export function runAction(
  key: string,
  id: number,
  action: string,
  context: ActionContext = {},
): ActionResult {
  const meta = moduleMeta(key)
  // 越权编辑直接拒绝：只读角色任何写动作都不落地。
  if (context.editable === false) {
    return { ok: false, message: '当前为只读角色，无权执行编辑操作' }
  }
  const dedupKey = ledgerKey(key, id, action)
  const cached = actionLedger.get(dedupKey)
  if (cached) {
    return { ...cached, duplicated: true }
  }

  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)

  // 主体状态已变化，清掉该主体的历史台账，允许后续新的首份提交。
  for (const ledgerAction of meta.actions) {
    actionLedger.delete(ledgerKey(key, id, ledgerAction))
  }

  let message = `${meta.entity}已${action}，当前状态「${target}」`

  // 停用站点 → 在仪器检定入口一并生成一条停用核查；核查只生成一次。
  if (key === 'station' && action === '停用站点') {
    const check = createStationDeactivationCheck(rows[index], context.now)
    message += check.duplicated
      ? '；停用核查此前已在仪器检定入口登记，不重复生成'
      : '；已在仪器检定入口生成停用核查'
  }

  const result: ActionResult = { ok: true, message }
  actionLedger.set(dedupKey, result)
  return result
}

function todayLabel(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * 停用站点的联动核查：在仪器检定模块补一条「停用核查」记录，状态为待送检。
 * 以站点编号幂等：重复停用不会产生第二份核查（配合首份提交规则）。
 */
function createStationDeactivationCheck(
  station: EntryRow,
  now: string | undefined,
): { duplicated: boolean } {
  const stationCode = String(station['站点编号'] ?? `ID-${station.id}`)
  const checkRows = listRows('calibration')
  const checkName = `停用核查·${stationCode}`
  const existed = checkRows.some((row) => String(row['仪器名称']) === checkName)
  if (existed) {
    return { duplicated: true }
  }
  const date = now ?? todayLabel()
  const nextId = checkRows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const record: EntryRow = {
    id: nextId,
    status: '待送检',
    pending: true,
    abnormal: true,
    记录编号: `CALI-CHK-${String(nextId).padStart(4, '0')}`,
    仪器编号: `CHK-${stationCode}`,
    仪器名称: checkName,
    检定单位: '站点停用联动',
    检定日期: date,
    有效期至: '—',
    检定结论: '停用待核查',
    检定状态: '待送检',
  }
  saveRows('calibration', [...checkRows, record])
  return { duplicated: false }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }

}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

export { STATION_FILTER_FIELDS, PAGE_SIZE_DEFAULT }
// 页面统计需要读到全量记录：统一从服务层出口取，换回后端时只改这一层。
export { listRows }
