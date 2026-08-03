// A declaration-only module (no compiled .js twin) describing a pure-DATA
// shape — the protobuf-message pattern: all fields Uint8Array/number/
// nested-data, no methods. The value is built by the importing program,
// never obtained FROM this module.
export interface Identity {
    readonly key: Uint8Array
    readonly signature: Uint8Array | undefined
    readonly version: number
    readonly nested: { readonly a: number; readonly tags: readonly string[] } | undefined
}
