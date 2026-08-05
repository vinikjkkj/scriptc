// The 2714/2715 shape with a VALUE on it: a data-only declaration module
// with no `.js` beside it at all. Those two corpus rules map this file's
// TYPES structurally, and their soundness argument is written down as
// "the ONLY way to obtain a value FROM the uncompiled module -- a value
// read / method call -- fences at its own value-import gate (SC1090)".
// The read below is that gate.
export interface Identity {
    readonly key: number
    readonly tag: string
}
export declare const DEFAULT_IDENTITY: Identity
