// `Object.defineProperty(<a compiled class instance>, <a RUN-TIME string>,
// <an accessor descriptor>)` -- zapo's `src/client/plugins/install.ts:114`,
// reduced:
//
//     Object.defineProperty(client, exposeAs, {
//       get: () => registry.instances.get(exposeAs),
//       enumerable: true, configurable: false })
//
// WHY THIS PROGRAM EXISTS: this was row 3 of the tagged refusals, and it
// refused at the RECEIVER. A compiled instance is a C struct with one cell
// per DECLARED member, so a property named by a run-time string had
// nowhere to live. It lives in the instance's `%props` table now, and the
// three surfaces a class instance HAS all have to read it: the define, the
// `in` six lines above it in zapo's own file, and util.inspect.
//
// The key is deliberately not a literal: `process.argv.length > 99` is
// false in every run, so the value is 'plug', but nothing about it is
// known at compile time. A literal key would let a folding path answer
// without ever reaching the table.
class Client {
  readonly name: string
  constructor(n: string) { this.name = n }
  greet(): string { return 'hi ' + this.name }
}

const client = new Client('c')
const instances = new Map<string, number>()
const exposeAs = process.argv.length > 99 ? 'zz' : 'plug'
instances.set(exposeAs, 7)

// Before the define: the closed member set answers, and it answers false.
console.log('before ' + String(exposeAs in client))

Object.defineProperty(client, exposeAs, {
  get: () => instances.get(exposeAs),
  enumerable: true,
  configurable: false
})

// After it: the same `in`, and it MUST see the table. This is the pair the
// whole row turns on -- the member set was called "closed" precisely
// because this define had no lowering.
console.log('after ' + String(exposeAs in client))
console.log('declared ' + String('name' in client))
console.log('proto ' + String('toString' in client))
console.log('absent ' + String('nope' in client))
console.log('literal ' + String('plug' in client))

// A declared member still reads through its own cell.
console.log(client.greet())

// util.inspect prints the run-time key AFTER the declared fields -- the
// table can only fill once the constructor has run -- and prints `[Getter]`
// rather than calling the getter.
console.log(client)

// A second instance shares the class and NOT the table.
const other = new Client('o')
console.log('other ' + String(exposeAs in other))
console.log(other)
