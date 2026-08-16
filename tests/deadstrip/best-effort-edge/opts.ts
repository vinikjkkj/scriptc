export interface Opts {
    probe: () => number
    bound: (n: number) => number
    arrow: (n: number) => number
}

export function buildDeps(o: Opts): number {
    return o.bound(1) + o.arrow(1)
}
