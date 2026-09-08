// The other direction: the redeclaration REMOVES the undefined arm of an
// inherited optional member. Commit f076f5e3 says this arm is handled; this is
// the positive control that the refusal is not blanket.
type BaseOpts = { session?: string; timeoutMS?: number }
export abstract class Base {
  options: BaseOpts
  constructor(o: BaseOpts = {}) { this.options = o }
  abstract run(): number
}
export abstract class Cmd extends Base {
  override options: { session: string; timeoutMS?: number }
  constructor(o: { session: string }) { super(o); this.options = o }
}
export class Impl extends Cmd { run(): number { return 1 } }
console.log(new Impl({ session: 'a' }).options.session)
