// The constructor's `new Array(count)` throws RangeError for a negative count,
// and the caller never gets a message object.
class Msg {
  public readonly ids: number[]
  constructor(public readonly count: number) {
    this.ids = new Array(this.count)
  }
}
function parse(n: number): Msg {
  const m = new Msg(n)
  for (let i = 0; i < n; i++) m.ids[i] = i
  return m
}
for (const n of [-3, 2]) {
  try {
    console.log("ok", parse(n).ids.join(","))
  } catch (e) {
    console.log("threw", (e as Error).name, (e as Error).message)
  }
}
