// B: identical, but the field's type is local.
interface Logger { warn(m: string): void }
export class Coord {
    constructor(readonly logger: Logger) {}
    commit<K extends string>(name: K, payload: Record<string, number>): void {
        console.log(name, payload)
    }
}
export function emit(c: Coord): void {
    c.commit('X', { a: 1 })
}
