<template>
  <section class="page" data-module="station">
    <header class="page-head">
      <div>
        <h2>监测站点管理</h2>
        <p class="page-desc">维护水文监测站，围绕站点编号、站点名称、站点类型、所在河流做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="toggleRole">
          {{ store.editable ? '切换为只读角色' : '切换为管理员' }}
        </button>
        <button class="btn primary" type="button" @click="openCreate">登记水文监测站</button>
        <button class="btn" type="button" @click="exportRows">导出监测站点清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in rangeStats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <!-- 检索条件：可钉在页面顶部，钉选状态只存在本次会话里，不落模板。 -->
    <div class="filter-dock" :class="{ pinned: pinned }">
      <form class="filter-bar" @submit.prevent="search">
        <label class="filter-item">
          <span>站点编号</span>
          <input v-model="filters['站点编号']" placeholder="按站点编号检索" />
        </label>
        <label class="filter-item">
          <span>所在河流</span>
          <input v-model="filters['所在河流']" placeholder="按所在河流检索" />
        </label>
        <label class="filter-item">
          <span>运行状态</span>
          <select v-model="filters['运行状态']">
            <option value="">全部状态</option>
            <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
          </select>
        </label>
        <button class="btn primary" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
        <button class="btn ghost" type="button" @click="pinned = !pinned">
          {{ pinned ? '取消钉住' : '钉在顶部' }}
        </button>
      </form>
    </div>

    <!-- 检索轨迹：查询后先在列表上方给出命中摘要，再进入明细。 -->
    <div v-if="hasSearched" class="hit-summary" :class="{ conflict: summary.matched === 0 }">
      <p class="summary-line">
        站点总数 <strong>{{ summary.total }}</strong>，命中
        <strong>{{ summary.matched }}</strong> 条
        <span v-if="summary.matched === 0" class="conflict-text">——当前条件组合无交集</span>
      </p>
      <ul v-if="summary.active.length" class="summary-conditions">
        <li v-for="item in summary.active" :key="item.field">
          「{{ item.field }}：{{ item.value }}」单独命中 {{ item.count }} 条
          <span v-if="item.count === 0" class="conflict-text">（该条件无数据）</span>
        </li>
      </ul>
      <p v-if="summary.matched === 0 && hasPartialHit" class="conflict-text">
        各条件分别有命中但交集为空，属条件冲突；已按全部条件取交集（优先精确的运行状态），可放宽河流或编号条件。
      </p>
      <p v-if="clampNotice" class="clamp-text">{{ clampNotice }}</p>
    </div>

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
            <button class="link" type="button" @click="openDetail(row)">查看明细</button>
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
          <td :colspan="columns.length + 2" class="empty-state">没有命中的监测站点，可调整检索条件后重试</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条监测站点记录，第 {{ page }} / {{ pageCount }} 页</span>
      <span class="pager">
        <button class="btn" type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <button class="btn" type="button" :disabled="page >= pageCount" @click="goPage(page + 1)">下一页</button>
      </span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 明细弹层：摘要之后的第二站，展示单站全字段。 -->
    <div v-if="detailRow" class="modal-mask" @click.self="closeDetail">
      <div class="modal-card">
        <header class="modal-head">
          <h3>站点明细 · {{ detailRow['站点编号'] }}</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>
        <dl class="detail-list">
          <div v-for="column in detailColumns" :key="column" class="detail-row">
            <dt>{{ column }}</dt>
            <dd>{{ detailRow[column] ?? '—' }}</dd>
          </div>
          <div class="detail-row">
            <dt>当前状态</dt>
            <dd>{{ detailRow.status }}</dd>
          </div>
        </dl>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  PAGE_SIZE_DEFAULT,
  runAction as applyAction,
  stationSearchSummary,
  STATION_FILTER_FIELDS,
} from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow, SearchSummary } from '@/data/types'

const store = useSessionStore()
const meta = moduleMeta('station')
const columns = ["站点编号", "站点名称", "站点类型", "所在河流", "经纬度坐标", "建站年份", "管理单位", "运行状态"]
const actions = meta.actions
const statuses = meta.statuses
const detailColumns = columns

const rows = ref<EntryRow[]>([])
const total = ref(0)
const page = ref(1)
const pageCount = ref(1)
const errorMessage = ref('')
const clampNotice = ref('')

// 表单条件 vs 已生效条件：点「查询」后条件才落到列表，检索轨迹以生效条件为准。
const emptyFilters = (): Record<string, string> =>
  Object.fromEntries(STATION_FILTER_FIELDS.map((field) => [field, '']))
const filters = ref<Record<string, string>>(emptyFilters())
const applied = ref<Record<string, string>>(emptyFilters())
const hasSearched = ref(false)
const pinned = ref(false)

const detailRow = ref<EntryRow | null>(null)

const summary = computed<SearchSummary>(() =>
  stationSearchSummary(applied.value),
)
const hasPartialHit = computed(
  () => summary.value.active.some((item) => item.count > 0),
)
const rangeStats = computed(() => {
  const all = stationSearchSummary({})
  const statusRows = stationSearchSummary({ 运行状态: '设备故障' })
  return [
    { label: '站点总数', value: all.total },
    { label: '正常运行数', value: stationSearchSummary({ 运行状态: '正常运行' }).matched },
    { label: '故障站点数', value: statusRows.matched },
  ]
})
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: stationSearchSummary({ 运行状态: status }).matched,
  })),
)

function toggleRole() {
  store.setRole(store.editable ? '只读用户' : '管理员')
}

function search() {
  hasSearched.value = true
  applied.value = { ...filters.value }
  page.value = 1
  reload()
}

function resetFilters() {
  filters.value = emptyFilters()
  applied.value = emptyFilters()
  hasSearched.value = false
  page.value = 1
  reload()
}

function goPage(target: number) {
  page.value = target
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '水文监测站登记入口尚未接入审批流'
}

function openDetail(row: EntryRow) {
  detailRow.value = row
}

function closeDetail() {
  detailRow.value = null
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, { editable: store.editable })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.duplicated
    ? `重复提交已忽略：${result.message}（只保留首份结果）`
    : result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  clampNotice.value = ''
  try {
    const payload = listEntries(meta.key, applied.value, {
      page: page.value,
      size: PAGE_SIZE_DEFAULT,
    })
    // 翻页越界（例如删数据后停在空页）：服务端收回第 1 页，这里同步并提示。
    if (payload.clamped && payload.page !== page.value) {
      clampNotice.value = `第 ${page.value} 页已越界，已回到第 1 页`
      page.value = payload.page
    }
    rows.value = payload.items
    total.value = payload.total
    pageCount.value = Math.max(1, Math.ceil(payload.total / payload.size))
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '监测站点列表读取失败'
  }
}

onMounted(reload)
</script>
