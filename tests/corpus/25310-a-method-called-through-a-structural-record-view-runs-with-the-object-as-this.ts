// A closure parameter (or a local) typed as a structural record `{ query: any }` over a compiled class instance or an object literal that reaches it
// through `any` is a VIEW of that object. `executor.query(args)` is a method call: JavaScript runs the member with `this` = the object, so the
// instance's own state is reachable inside it and a write through `this` is visible afterwards. zapo's postgres stores pass their pool this way.
class Counter {
  n = 5
  calls = 0
  query(k: number, label: string): string {
    this.calls += 1
    this.n += k
    return label + ':' + this.n + ':' + this.calls
  }
}

function makeCounter(): any {
  return new Counter()
}

function makeLiteral(): any {
  return {
    base: 100,
    query(k: number, label: string): string {
      this.base += k
      return label + ':' + this.base
    },
  }
}

function viaParam(executor: { query: any }, k: number): string {
  return executor.query(k, 'param')
}

function viaLocal(o: any, k: number): string {
  const e: { query: any } = o
  return e.query(k, 'local')
}

function viaClosure(o: any): string {
  const run = (executor: { query: any }, k: number): string => executor.query(k, 'closure')
  return run(o, 3) + '|' + run(o, 4)
}

async function viaAsync(o: any): Promise<string> {
  const run = async (executor: { query: any }): Promise<string> => {
    const r = await Promise.resolve(executor.query(7, 'async'))
    return r
  }
  return await run(o)
}

function plainRecord(): string {
  // a record literal with a real function member: not a view, the call is the plain field call
  let hits = 0
  const lit: { query: any } = { query: (k: number, label: string) => { hits += k; return label + ':' + hits } }
  return viaParam(lit, 2) + '|' + viaParam(lit, 3)
}

async function main(): Promise<void> {
  const c = makeCounter()
  console.log(viaParam(c, 1))
  console.log(viaLocal(c, 2))
  console.log(viaClosure(c))
  console.log(await viaAsync(c))
  console.log('state', c.n, c.calls)
  const l = makeLiteral()
  console.log(viaParam(l, 1))
  console.log(viaLocal(l, 2))
  console.log(viaClosure(l))
  console.log('literal', l.base)
  console.log(plainRecord())
}

main()
