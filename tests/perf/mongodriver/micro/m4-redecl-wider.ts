// mongodb operations/command.ts:93 shape: `override options: Wider` over an
// inherited all-optional record, with no initializer.
type BaseOpts = { session?: string; timeoutMS?: number }
type CmdOpts = { session?: string; timeoutMS?: number; dbName?: string; authdb?: string }
export abstract class Base<T> {
  options: BaseOpts
  constructor(o: BaseOpts = {}) { this.options = o }
  abstract run(): T
}
export abstract class Cmd<T> extends Base<T> {
  override options: CmdOpts
  constructor(o?: CmdOpts) { super(o); this.options = o ?? {} }
}
export class Impl extends Cmd<number> { run(): number { return 1 } }
console.log(new Impl({ dbName: 'a' }).options.dbName)
