// zapo's store lock wrappers: (store as { destroy?: () => Promise<void> }).destroy?.() where the interface lacks destroy and the
// class instance behind it (own or inherited method) has it. A class without it must read undefined and call nothing.
interface AuthStore { load(): number; clear(): void }
let destroyed = 0
class Base { async destroy(): Promise<void> { destroyed++ } }
class Impl extends Base implements AuthStore { load() { return 1 } clear() {} }
class Own implements AuthStore { load() { return 3 } clear() {} async destroy(): Promise<void> { destroyed += 100 } }
class Plain implements AuthStore { load() { return 2 } clear() {} }
function create(k: number): AuthStore { return k === 0 ? new Impl() : k === 1 ? new Own() : new Plain() }
async function shut(store: AuthStore): Promise<string> {
  const d = store as { destroy?: () => Promise<void> }
  const had = typeof d.destroy
  await d.destroy?.()
  return had
}
async function main() {
  for (let k = 0; k < 3; k++) {
    const had = await shut(create(k))
    console.log(k, had, destroyed)
  }
}
main()
