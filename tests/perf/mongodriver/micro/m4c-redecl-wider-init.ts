// m4 with an INITIALIZER on the redeclaration. The refusal names two reasons:
// the type change AND the missing initializer (Node resets the field). This
// arm removes only the second.
type BaseOpts = { session?: string; timeoutMS?: number }
type CmdOpts = { session?: string; timeoutMS?: number; dbName?: string; authdb?: string }
export abstract class Base<T> {
  options: BaseOpts
  constructor(o: BaseOpts = {}) { this.options = o }
  abstract run(): T
}
export abstract class Cmd<T> extends Base<T> {
  override options: CmdOpts = {}
  constructor(o?: CmdOpts) { super(o); this.options = o ?? {} }
}
export class Impl extends Cmd<number> { run(): number { return 1 } }
console.log(new Impl({ dbName: 'a' }).options.dbName)
