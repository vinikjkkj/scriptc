// A: the receiver class has a field whose TYPE comes from an island package.
import type { Logger } from 'zapo-js'
export class Coord {
    constructor(readonly logger: Logger) {}
    commit<K extends string>(name: K, payload: Record<string, number>): void {
        console.log(name, payload)
    }
}
export function emit(c: Coord): void {
    c.commit('X', { a: 1 })
}
