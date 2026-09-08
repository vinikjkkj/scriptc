// The control for m3: identical, with the `this.constructor` read removed.
export abstract class Base<T> {
  static aspects?: string[]
  hasAspect(a: string): boolean {
    const ctor = { aspects: undefined } as { aspects?: string[] }
    if (ctor.aspects == null) return false
    return ctor.aspects.indexOf(a) >= 0
  }
  abstract run(): T
}
export class Impl extends Base<number> { run(): number { return 1 } }
console.log(new Impl().hasAspect('x'))
