// The case commit f076f5e3 says IS handled: the inherited slot is an
// undefined-armed union and the redeclaration removes the undefined arm.
// Positive control that the arm-removal feature is present at all.
export abstract class Base {
  collection?: string
  constructor(c?: string) { this.collection = c }
  abstract run(): number
}
export abstract class Cmd extends Base {
  override collection: string
  constructor(c: string) { super(c); this.collection = c }
}
export class Impl extends Cmd { run(): number { return 1 } }
console.log(new Impl('a').collection)
