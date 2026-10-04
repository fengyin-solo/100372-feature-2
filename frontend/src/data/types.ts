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
  /** 请求页码越界被拉回第 1 页时为 true，由页面提示 */
  pageClamped?: boolean
}

/** 分页参数：缺省不分页，保持旧调用行为 */
export type ListOptions = {
  page?: number
  size?: number
}

/** 操作人上下文：页面传给服务层做越权校验，缺省视为旧调用放行 */
export type Actor = {
  operator?: string
  role?: string
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
