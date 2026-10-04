import { defineStore } from 'pinia'

export type SessionRole = 'admin' | 'operator' | 'viewer'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '水文监测站网管理系统',
    // 当前值班角色：越权编辑校验以它为准，只在本次会话内存里生效
    role: 'admin' as SessionRole,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    canEdit: (state) => state.role !== 'viewer',
    canManage: (state) => state.role === 'admin',
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: SessionRole) {
      this.role = role
    },
  },
})
