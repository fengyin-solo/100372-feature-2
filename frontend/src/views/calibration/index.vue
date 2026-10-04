<template>
  <section class="page" data-module="calibration">
    <header class="page-head">
      <div>
        <h2>仪器检定管理</h2>
        <p class="page-desc">维护仪器检定记录，围绕记录编号、仪器编号、仪器名称、检定单位做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="toggleRole">
          {{ store.editable ? '切换为只读角色' : '切换为管理员' }}
        </button>
        <button class="btn primary" type="button" @click="openCreate">登记仪器检定记录</button>
        <button class="btn" type="button" @click="exportRows">导出仪器检定清单</button>
      </div>
    </header>

    <!-- 停用站点的联动核查会落到这里：有待核查记录时置顶提示。 -->
    <p v-if="linkedCheckCount" class="linked-notice">
      有 {{ linkedCheckCount }} 条监测站停用联动生成的待核查记录（停用核查），请尽快安排检定。
    </p>

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

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'linked-row': isLinkedCheck(row) }">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
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
          <td :colspan="columns.length + 2" class="empty-state">暂无仪器检定数据，可先登记仪器检定记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条仪器检定记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  filterRows,
  listRows,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const store = useSessionStore()
const meta = moduleMeta('calibration')
const columns = ["记录编号", "仪器编号", "仪器名称", "检定单位", "检定日期", "有效期至", "检定结论", "检定状态"]
const actions = ["送出检定", "确认合格", "标记不合格"]
const statuses = ["待送检", "送检中", "已合格", "不合格", "已停用"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

function isLinkedCheck(row: EntryRow): boolean {
  return String(row['检定单位']) === '站点停用联动'
}

const linkedCheckCount = computed(
  () => listRows(meta.key).filter((row) => isLinkedCheck(row) && row.status === '待送检').length,
)
const stats = computed(() => {
  const all = listRows(meta.key)
  return [
    { label: "待送检仪器", value: all.filter((row) => row.status === '待送检').length },
    { label: "已合格仪器", value: all.filter((row) => row.status === '已合格').length },
    { label: "不合格仪器", value: all.filter((row) => row.status === '不合格').length },
  ]
})
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: listRows(meta.key).filter((row) => String(row.status) === status).length,
  })),
)

function toggleRole() {
  store.setRole(store.editable ? '只读用户' : '管理员')
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '仪器检定记录登记入口尚未接入审批流'
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
  try {
    const matched = filterRows(listRows(meta.key), filters.value)
    rows.value = matched
    total.value = matched.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '仪器检定列表读取失败'
  }
}

onMounted(reload)
</script>
