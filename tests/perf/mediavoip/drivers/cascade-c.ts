// C: same as A, but zapo-js is also VALUE-imported, so --provenance-sources engages.
import { createNoopLogger, type Logger } from 'zapo-js'
export class Coord {
    constructor(readonly logger: Logger) {}
    commit<K extends string>(name: K, payload: Record<string, number>): void {
        console.log(name, payload)
    }
}
export function emit(c: Coord): void {
    c.commit('X', { a: 1 })
}
console.log(typeof createNoopLogger)
