// The same undefined-arm removal, but on a RECORD-typed field, to separate
// "the field's own type is an undefined-armed union" from "the record's
// members changed optionality".
type O = { a?: string }
export abstract class Base {
  options?: O
  constructor(o?: O) { this.options = o }
  abstract run(): number
}
export abstract class Cmd extends Base {
  override options: O
  constructor(o: O) { super(o); this.options = o }
}
export class Impl extends Cmd { run(): number { return 1 } }
console.log(new Impl({ a: 'x' }).options.a)
