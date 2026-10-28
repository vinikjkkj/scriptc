'use strict'
class PendingItem {
  constructor(callback) {
    this.callback = callback
  }
}
function go(cb) {
  const pendingItem = new PendingItem(cb)
  const tid = setTimeout(() => {
    pendingItem.timedOut = true
    console.log('timed', pendingItem.timedOut, typeof pendingItem.callback)
  }, 1)
  return pendingItem
}
const p = go(() => 1)
const q = { cb: 2 }
setTimeout(() => { q.hit = 9; console.log('q', q.hit) }, 2)
console.log('sync', p.timedOut)
