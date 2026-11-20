interface AuthStore { load(): number; clear(): void }
type WithDestroy<T> = T & { destroy(): void }
let destroyed = 0
function createRaw(): AuthStore {
  const s = { load: () => 1, clear: () => {}, destroy: () => { destroyed++ } }
  return s
}
function withLock(store: AuthStore): WithDestroy<AuthStore> {
  const destroyStore = store as { destroy?: () => void }
  return {
    load: () => store.load(),
    clear: () => store.clear(),
    destroy: () => { destroyStore.destroy?.() }
  }
}
const w = withLock(createRaw())
w.destroy()
console.log("destroyed", destroyed)
// the same through a wider named view
const wide = { load: () => 2, clear: () => {}, destroy: () => { destroyed += 10 } }
const w2 = withLock(wide)
w2.destroy()
console.log("destroyed", destroyed)
export {}
