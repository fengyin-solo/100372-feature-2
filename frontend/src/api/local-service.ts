import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  Actor,
  EntryRow,
  ListOptions,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 站点落入这些状态就算「停用」：仪器要送到检定入口一并生成核查。
const STATION_OFFLINE_STATUSES = ['暂停运行', '已撤销']

// 运行状态类条件匹配实时状态列 status，同名的样本字段（运行状态）不参与检索。
const STATUS_FILTER_FIELDS = new Set(['运行状态', 'status'])

const ROLE_LABELS: Record<string, string> = {
  admin: '系统管理员',
  operator: '值班员',
  viewer: '观测员',
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => {
      const keyword = value.trim()
      if (STATUS_FILTER_FIELDS.has(field)) {
        return String(row.status ?? '').includes(keyword)
      }
      return String(row[field] ?? '').includes(keyword)
    }),
  )
}

export function listEntries(
  key: string,
  filters: Record<string, string> = {},
  options: ListOptions = {},
): PageResult {
  const matched = filterRows(listRows(key), filters)
  const size = Math.floor(Number(options.size) || 0)
  if (size <= 0) {
    // 旧调用不分页：全量返回，行为保持不变
    return { items: matched, total: matched.length, page: 1, size: matched.length }
  }
  const maxPage = Math.max(1, Math.ceil(matched.length / size))
  let page = Math.max(1, Math.floor(Number(options.page) || 1))
  let pageClamped = false
  if (page > maxPage) {
    // 翻页越界回第 1 页，由页面提示
    page = 1
    pageClamped = true
  }
  const start = (page - 1) * size
  return { items: matched.slice(start, start + size), total: matched.length, page, size, pageClamped }
}

// 越权编辑拒绝：viewer 全部拒绝，operator 不能执行负向动作；不带 actor 的旧调用保持放行。
function authorityError(action: string, actor?: Actor): string | null {
  if (!actor) {
    return null
  }
  const role = actor.role ?? 'viewer'
  if (role === 'admin') {
    return null
  }
  const negative = NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb))
  if (role === 'operator' && !negative) {
    return null
  }
  const label = ROLE_LABELS[role] ?? role
  const who = actor.operator ? `${actor.operator}（${label}）` : label
  return `${who}无权执行「${action}」，越权编辑已拒绝`
}

export function runAction(key: string, id: number, action: string, actor?: Actor): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const denied = authorityError(action, actor)
  if (denied) {
    return { ok: false, message: denied }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    // 重复提交只保留首份结果：状态已流转过就不再重复写
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
  let message = `${meta.entity}已${action}，当前状态「${target}」`
  if (key === 'station' && STATION_OFFLINE_STATUSES.includes(target)) {
    // 停用站点：在仪器检定入口一并生成核查；同一站点重复停用只保留首份核查
    const check = ensureStationCalibrationCheck(updated)
    message += check.created
      ? `；仪器检定入口已生成核查 ${check.code}`
      : `；检定核查 ${check.code} 已存在，保留首份结果`
  }
  return { ok: true, message }
}

function today(): string {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${mm}-${dd}`
}

// 站点停用后在「仪器检定」模块登记核查：按站点编号去重，已存在就保留首份。
function ensureStationCalibrationCheck(station: EntryRow): { created: boolean; code: string } {
  const rows = listRows('calibration')
  const stationCode = String(station['站点编号'] ?? '').trim() || `STATION-${station.id}`
  const existing = rows.find((row) => String(row['仪器编号'] ?? '') === stationCode)
  if (existing) {
    return { created: false, code: String(existing['记录编号'] ?? '') }
  }
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const code = `CALI-${String(nextId).padStart(4, '0')}`
  const check: EntryRow = {
    id: nextId,
    status: '待送检',
    pending: true,
    abnormal: false,
    '记录编号': code,
    '仪器编号': stationCode,
    '仪器名称': `停用核查·${String(station['站点名称'] ?? stationCode)}`,
    '检定单位': String(station['管理单位'] ?? ''),
    '检定日期': today(),
    '有效期至': '—',
    '检定结论': '待核查',
    '检定状态': '待送检',
  }
  saveRows('calibration', [...rows, check])
  return { created: true, code }
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
