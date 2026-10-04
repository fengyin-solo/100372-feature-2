/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
  /** 请求页码越界或非法时，服务端已把页码收回到第 1 页。 */
  clamped?: boolean
}

export type ActionResult = {
  ok: boolean
  message: string
  /** 同主体同动作的重复提交被忽略，消息沿用首份结果。 */
  duplicated?: boolean
}

export type ActionContext = {
  /** 是否具备编辑权限；显式传 false 时按越权拒绝处理。 */
  editable?: boolean
  /** 联动生成记录时使用的业务日期（YYYY-MM-DD），默认取当天。 */
  now?: string
}

export type ConditionHit = {
  field: string
  value: string
  count: number
}

export type SearchSummary = {
  total: number
  matched: number
  active: ConditionHit[]
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
