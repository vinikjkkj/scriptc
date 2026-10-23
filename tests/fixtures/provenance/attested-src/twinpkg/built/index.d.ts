export declare const LIMIT: 7
export declare function twice(n: number): number
export declare class Box {
    v: number
    constructor(v: number)
    get(): number
    static make(n: number): Box
    static readonly KIND: string
}
export declare class Other extends Box {
    constructor()
    tag(): string
}
