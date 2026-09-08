// m4 with `declare`: type-only, so Node emits no [[Define]] and there is no
// reset. This arm removes the reset and KEEPS the type change.
type BaseOpts = { session?: string; timeoutMS?: number }
type CmdOpts = { session?: string; timeoutMS?: number; dbName?: string; authdb?: string }
export abstract class Base<T> {
  options: BaseOpts
  constructor(o: BaseOpts = {}) { this.options = o }
  abstract run(): T
}
export abstract class Cmd<T> extends Base<T> {
  declare options: CmdOpts
  constructor(o?: CmdOpts) { super(o); this.options = o ?? {} }
}
export class Impl extends Cmd<number> { run(): number { return 1 } }
console.log(new Impl({ dbName: 'a' }).options.dbName)
