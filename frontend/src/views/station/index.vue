<template>
  <section class="page" data-module="station">
    <header class="page-head">
      <div>
        <h2>监测站点管理</h2>
        <p class="page-desc">维护水文监测站，围绕站点编号、站点名称、站点类型、所在河流做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记水文监测站</button>
        <button class="btn" type="button" @click="exportRows">导出监测站点清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <!-- 钉住的条件常驻页面顶部，只留在本次会话内存里，不保存模板 -->
    <div v-if="pinnedEntries.length" class="pinned-bar">
      <span class="pinned-label">已钉住条件</span>
      <span v-for="item in pinnedEntries" :key="item.field" class="chip">
        {{ item.field }}：{{ item.value }}
        <button class="chip-close" type="button" @click="unpin(item.field)">×</button>
      </span>
      <button class="link" type="button" @click="clearPinned">全部取消</button>
    </div>

    <form class="filter-bar" @submit.prevent="submitSearch">
      <label class="filter-item">
        <span>站点编号</span>
        <input v-model="form['站点编号']" placeholder="按站点编号检索" />
      </label>
      <label class="filter-item">
        <span>所在河流</span>
        <input v-model="form['所在河流']" placeholder="按所在河流检索" />
      </label>
      <label class="filter-item">
        <span>运行状态</span>
        <select v-model="form['运行状态']">
          <option value="">全部状态</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="pinConditions">钉住条件</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <!-- 命中摘要：先出摘要，再由「进入明细」刷新列表 -->
    <div v-if="summary" class="hit-summary">
      <div class="summary-main">
        <strong>命中 {{ summary.total }} 条监测站点</strong>
        <span>生效条件：{{ summary.conditionText }}</span>
        <span v-if="summary.statusText">状态分布：{{ summary.statusText }}</span>
        <span v-if="summary.note" class="summary-note">{{ summary.note }}</span>
      </div>
      <button class="btn primary" type="button" @click="enterDetail">进入明细</button>
    </div>

    <details v-if="traces.length" class="trace-panel">
      <summary>检索轨迹（{{ traces.length }} 条，仅本次会话）</summary>
      <ul>
        <li v-for="trace in traces" :key="trace.id">
          {{ trace.time }} · {{ trace.conditionText }} · 命中 {{ trace.total }} 条
        </li>
      </ul>
    </details>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">查看</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无监测站点数据，可先登记水文监测站</td>
        </tr>
      </tbody>
    </table>

    <aside v-if="detailRow" class="detail-panel">
      <header class="detail-head">
        <h3>站点明细 · {{ detailRow['站点编号'] }}</h3>
        <button class="link" type="button" @click="detailRow = null">关闭</button>
      </header>
      <dl class="detail-grid">
        <template v-for="column in columns" :key="column">
          <dt>{{ column }}</dt>
          <dd>{{ detailRow[column] ?? '—' }}</dd>
        </template>
        <dt>当前状态</dt>
        <dd>{{ detailRow.status }}</dd>
        <dt>待处理</dt>
        <dd>{{ detailRow.pending ? '是' : '否' }}</dd>
        <dt>异常标记</dt>
        <dd>{{ detailRow.abnormal ? '是' : '否' }}</dd>
      </dl>
    </aside>

    <footer class="page-foot">
      <span>共 {{ total }} 条监测站点记录</span>
      <div class="pager">
        <button class="btn ghost" type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <span>第 {{ page }} / {{ maxPage }} 页</span>
        <button class="btn ghost" type="button" :disabled="page >= maxPage" @click="goPage(page + 1)">下一页</button>
        <select v-model.number="pageSize" @change="goPage(1)">
          <option v-for="size in pageSizes" :key="size" :value="size">每页 {{ size }} 条</option>
        </select>
      </div>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

// 检索轨迹条目：一次查询的生效条件与命中结果，只留在页面内存里
type Trace = {
  id: number
  time: string
  conditions: Record<string, string>
  conditionText: string
  total: number
  statusText: string
  signature: string
  note?: string
}

const meta = moduleMeta('station')
const session = useSessionStore()
const route = useRoute()

const columns = meta.fields
const actions = meta.actions
const statuses = meta.statuses

// 检索链路的三条件，合并顺序以此为准；筛选冲突时：钉住 > 表单 > 旧参数
const SEARCH_FIELDS = ['站点编号', '所在河流', '运行状态']
// 旧版参数（站点名称、站点类型）继续生效，从路由 query 读入
const LEGACY_FIELDS = ['站点名称', '站点类型']
const CLAMP_NOTICE = '翻页越界，已回到第 1 页'

const rows = ref<EntryRow[]>([])
const moduleRows = ref<EntryRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(5)
const pageSizes = [5, 10, 20]
const errorMessage = ref('')
const noticeMessage = ref('')

const form = ref<Record<string, string>>({ '站点编号': '', '所在河流': '', '运行状态': '' })
const legacy = ref<Record<string, string>>({})
const pinned = ref<Record<string, string>>({})
const applied = ref<Record<string, string>>({})
const traces = ref<Trace[]>([])
const summary = ref<Trace | null>(null)
const detailRow = ref<EntryRow | null>(null)
let traceSeq = 0

const maxPage = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

const pinnedEntries = computed(() =>
  Object.entries(pinned.value).map(([field, value]) => ({ field, value })),
)

const stats = computed(() => [
  { label: '站点总数', value: moduleRows.value.length },
  { label: '正常运行数', value: countStatus('正常运行') },
  { label: '故障站点数', value: countStatus('设备故障') },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: moduleRows.value.filter((row) => String(row.status) === status).length,
  })),
)

function countStatus(status: string): number {
  return moduleRows.value.filter((row) => String(row.status) === status).length
}

// 合并生效条件：旧参数垫底，表单覆盖同名，钉住的条件优先（钉住 = 显式锁定）
function effectiveConditions(): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const field of [...SEARCH_FIELDS, ...LEGACY_FIELDS]) {
    const value = String(legacy.value[field] ?? '').trim()
    if (value) {
      merged[field] = value
    }
  }
  for (const field of SEARCH_FIELDS) {
    const value = String(form.value[field] ?? '').trim()
    if (value) {
      merged[field] = value
    }
  }
  for (const [field, value] of Object.entries(pinned.value)) {
    if (value.trim()) {
      merged[field] = value.trim()
    }
  }
  return merged
}

function conditionText(conditions: Record<string, string>): string {
  const parts = Object.entries(conditions).map(([field, value]) => {
    const source = pinned.value[field] ? '（钉住）' : legacy.value[field] ? '（旧参数）' : ''
    return `${field}=${value}${source}`
  })
  return parts.length ? parts.join('，') : '无条件（全量）'
}

function signatureOf(conditions: Record<string, string>): string {
  return Object.keys(conditions)
    .sort()
    .map((field) => `${field}=${conditions[field]}`)
    .join('&')
}

// 查询：先算命中摘要显示在列表上方，列表等「进入明细」再刷新
function submitSearch() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const conditions = effectiveConditions()
  const signature = signatureOf(conditions)
  const existing = traces.value.find((trace) => trace.signature === signature)
  if (existing) {
    // 重复提交只保留首份结果：复用首次命中，不追加轨迹
    summary.value = { ...existing, note: '重复提交，仅保留首份检索结果' }
    return
  }
  const matched = listEntries(meta.key, conditions)
  const statusText = statuses
    .map((status: string) => ({
      status,
      count: matched.items.filter((row) => String(row.status) === status).length,
    }))
    .filter((item) => item.count > 0)
    .map((item) => `${item.status} ${item.count}`)
    .join(' · ')
  traceSeq += 1
  const trace: Trace = {
    id: traceSeq,
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    conditions,
    conditionText: conditionText(conditions),
    total: matched.total,
    statusText,
    signature,
  }
  traces.value = [trace, ...traces.value].slice(0, 5)
  summary.value = trace
}

// 进入明细：列表应用摘要里的生效条件，页码回到 1
function enterDetail() {
  applied.value = { ...(summary.value?.conditions ?? {}) }
  page.value = 1
  detailRow.value = null
  reload()
}

function pinConditions() {
  const next = { ...pinned.value }
  for (const field of SEARCH_FIELDS) {
    const value = String(form.value[field] ?? '').trim()
    if (value) {
      next[field] = value
    }
  }
  pinned.value = next
  applyNow()
}

function unpin(field: string) {
  const next = { ...pinned.value }
  delete next[field]
  pinned.value = next
  applyNow()
}

function clearPinned() {
  pinned.value = {}
  applyNow()
}

// 钉住变化立即生效：刷新摘要并直接进入明细
function applyNow() {
  submitSearch()
  enterDetail()
}

function resetFilters() {
  form.value = { '站点编号': '', '所在河流': '', '运行状态': '' }
  legacy.value = {}
  pinned.value = {}
  applied.value = {}
  summary.value = null
  detailRow.value = null
  page.value = 1
  reload()
}

function goPage(target: number) {
  page.value = target
  reload()
}

function openDetail(row: EntryRow) {
  detailRow.value = row
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '水文监测站登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, {
    operator: session.operator,
    role: session.role,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, applied.value, { page: page.value, size: pageSize.value })
    rows.value = payload.items
    total.value = payload.total
    page.value = payload.page
    if (payload.pageClamped) {
      noticeMessage.value = CLAMP_NOTICE
    } else if (noticeMessage.value === CLAMP_NOTICE) {
      noticeMessage.value = ''
    }
    // 统计与图例基于模块全量，不随检索与翻页变化
    moduleRows.value = listEntries(meta.key).items
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '监测站点列表读取失败'
  }
}

onMounted(() => {
  // 兼容旧参数：路由 query 里的站点名称/站点类型等旧条件继续生效
  for (const field of [...SEARCH_FIELDS, ...LEGACY_FIELDS]) {
    const value = route.query[field]
    if (typeof value === 'string' && value.trim()) {
      if (SEARCH_FIELDS.includes(field)) {
        form.value[field] = value.trim()
      } else {
        legacy.value[field] = value.trim()
      }
    }
  }
  const hasQuery =
    Object.values(form.value).some((value) => value.trim()) || Object.keys(legacy.value).length > 0
  if (hasQuery) {
    submitSearch()
    enterDetail()
  } else {
    reload()
  }
})
</script>
