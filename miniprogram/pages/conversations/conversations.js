const { call } = require('../../utils/cloud')
const aiLocal = require('../../utils/ai-local-sessions')

Page({
  data: {
    loading: true,
    aiHistoryRows: [],
    roomRows: [],
    pendingInviteCount: 0,
    firstPendingInviteId: ''
  },

  onShow() {
    const app = getApp()
    if (app && app.globalData && !app.globalData.didAutoOpenChatOnce) {
      app.globalData.didAutoOpenChatOnce = true
      wx.navigateTo({
        url: '/pages/chat/chat',
        fail: () => {}
      })
    }
    this.loadRooms()
  },

  roomColorIndex(roomId) {
    const s = String(roomId || '')
    let n = 0
    for (let i = 0; i < s.length; i++) n += s.charCodeAt(i)
    return Math.abs(n) % 5
  },

  async loadRooms() {
    this.setData({ loading: true })
    const aiMetas = aiLocal.getMetaList()
    const aiHistoryRows = aiMetas.map((m) => ({
      kind: 'ai',
      rowKey: 'ai_' + m.id,
      sessionId: m.id,
      title: '会话',
      preview: m.preview || '',
      lastTime: this.formatTime(m.updatedAt),
      sortTime: m.updatedAt
    }))
    aiHistoryRows.sort((a, b) => (b.sortTime || 0) - (a.sortTime || 0))
    try {
      const [res, invRes] = await Promise.all([
        call('listChatRooms', {}),
        call('listMyPendingStrangerMatchInvites', {}).catch(() => ({ invites: [] }))
      ])
      const invites = (invRes && invRes.invites) || []
      const pendingInviteCount = invites.length
      const firstPendingInviteId = invites[0] && invites[0].inviteId ? String(invites[0].inviteId) : ''

      const roomRows = (res.rooms || []).map((r) => {
        const roomId = r.roomId || r._id
        const lastMs = Number(r.lastMsgAtMs) || 0
        let lastSeen = 0
        try {
          lastSeen = Number(wx.getStorageSync('xc_room_last_seen_' + roomId) || 0) || 0
        } catch (e) {}
        const unread = lastMs > 0 && lastMs > lastSeen ? 1 : 0
        return {
          kind: 'room',
          rowKey: 'room_' + roomId,
          roomId,
          title: r.title || r.name || '会话',
          preview: r.lastMessage || '暂无消息',
          lastTime: r.lastMsgAt || this.formatTime(r.lastMsgAtMs) || '',
          sortTime: lastMs,
          unread,
          reviewPending: !!r.reviewPending,
          colorIndex: this.roomColorIndex(roomId)
        }
      })
      roomRows.sort((a, b) => (b.sortTime || 0) - (a.sortTime || 0))
      this.setData({ aiHistoryRows, roomRows, loading: false, pendingInviteCount, firstPendingInviteId })
    } catch (e) {
      console.error('加载会话失败', e)
      this.setData({ aiHistoryRows, roomRows: [], loading: false, pendingInviteCount: 0, firstPendingInviteId: '' })
    }
  },

  openNewAiChat() {
    wx.navigateTo({ url: '/pages/chat/chat?aiNew=1' })
  },

  openPendingStrangerInvites() {
    const id = String(this.data.firstPendingInviteId || '').trim()
    if (!id) {
      wx.switchTab({ url: '/pages/notify/notify' })
      return
    }
    const n = this.data.pendingInviteCount || 0
    wx.navigateTo({
      url: '/pages/chat/chat?focusStrangerInviteId=' + encodeURIComponent(id),
      fail: () => wx.switchTab({ url: '/pages/notify/notify' })
    })
    if (n > 1) {
      setTimeout(() => {
        wx.showToast({ title: '另有 ' + (n - 1) + ' 条可在「通知」查看', icon: 'none' })
      }, 400)
    }
  },

  onRowTap(e) {
    const ds = e.currentTarget.dataset || {}
    if (ds.kind === 'ai' && ds.sessionid) {
      wx.navigateTo({
        url: '/pages/chat/chat?aiSessionId=' + encodeURIComponent(ds.sessionid)
      })
      return
    }
    const id = ds.id
    const title = ds.title
    if (!id) return
    wx.navigateTo({
      url: '/pages/chat/chat?openRoomId=' + id + '&roomTitle=' + encodeURIComponent(title || '会话')
    })
  },

  formatTime(t) {
    if (t === undefined || t === null || t === '') return ''
    const d = t instanceof Date ? t : new Date(t)
    if (Number.isNaN(d.getTime())) return ''
    const now = Date.now()
    const diff = now - d.getTime()
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
    if (diff < 172800000) return '昨天'
    return d.getMonth() + 1 + '/' + d.getDate()
  }
})
