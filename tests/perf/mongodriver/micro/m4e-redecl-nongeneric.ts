// m4 with the generic parameter removed: is the refusal about the redeclaration
// alone, or only about it inside a GENERIC class instantiation?
type BaseOpts = { session?: string; timeoutMS?: number }
type CmdOpts = { session?: string; timeoutMS?: number; dbName?: string; authdb?: string }
export abstract class Base {
  options: BaseOpts
  constructor(o: BaseOpts = {}) { this.options = o }
  abstract run(): number
}
export abstract class Cmd extends Base {
  override options: CmdOpts
  constructor(o?: CmdOpts) { super(o); this.options = o ?? {} }
}
export class Impl extends Cmd { run(): number { return 1 } }
console.log(new Impl({ dbName: 'a' }).options.dbName)
