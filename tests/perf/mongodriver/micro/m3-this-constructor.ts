// mongodb operations/operation.ts:92 shape: reading a static through
// `this.constructor` inside a generic base class.
export abstract class Base<T> {
  static aspects?: string[]
  hasAspect(a: string): boolean {
    const ctor = this.constructor as { aspects?: string[] }
    if (ctor.aspects == null) return false
    return ctor.aspects.indexOf(a) >= 0
  }
  abstract run(): T
}
export class Impl extends Base<number> { run(): number { return 1 } }
console.log(new Impl().hasAspect('x'))
