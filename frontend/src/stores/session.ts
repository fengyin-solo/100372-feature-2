import { defineStore } from 'pinia'

type Role = '管理员' | '只读用户'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    role: '管理员' as Role,
    shiftLabel: '白班 08:00-20:00',
    scope: '水文监测站网管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    // 只读角色可看不可改：所有写动作在服务层据此拒绝。
    editable: (state) => state.role === '管理员',
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: Role) {
      this.role = role
    },
  },
})
