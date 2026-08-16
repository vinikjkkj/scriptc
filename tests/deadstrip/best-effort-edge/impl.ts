import { buildDeps } from './opts'
import { Sink } from './sink'

export class Impl {
    value: number
    sink: Sink
    constructor() {
        this.sink = new Sink()
        // One statement, three func-valued members. `probe` has no static
        // lowering; --best-effort turns it into a trap closure and lowers
        // ON, so the two members AFTER it resolve `onlyBound` and
        // `Sink.take` — whose only edges these are.
        this.value = buildDeps({
            probe: (): number => Reflect.ownKeys({ a: 1 }).length,
            bound: this.onlyBound.bind(this),
            arrow: (n: number): number => this.sink.take(n)
        })
    }

    private onlyBound(n: number): number {
        return n + 22
    }
}
