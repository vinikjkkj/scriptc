// A class instance in a `T | null`-typed binding ALIASES the instance, as the plain binding and a parameter do: every later read
// through the nullable binding answers what the object holds now (it used to answer what it held at the assignment).
export {}
interface Counters { calls: number }
class Rpc {
  public calls = 0
  public bump(): void { this.calls += 1 }
}
const rpc = new Rpc()
const plain: Counters = rpc
let nullable: Counters | null = null
nullable = rpc
function viaParam(c: Counters): number { return c.calls }
rpc.bump()
rpc.bump()
rpc.bump()
console.log("instance " + rpc.calls)
console.log("plain " + plain.calls)
console.log("param " + viaParam(rpc))
console.log("nullable " + (nullable === null ? -1 : nullable.calls))
