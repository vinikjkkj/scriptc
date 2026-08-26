// NEGATIVE CONTROL: a genuine type error that every lane must report.
// If this file reports zero SC0001 sites, the query is broken, not the lane.
export function bad(): number {
    const s: string = 'x'
    const n: number = s
    return n
}
