/* A second generated module, declared here and implemented in the index.js
 * beside it. Its whole point is HOW the package reaches it: `src/index.ts`
 * carries a bare RE-EXPORT and no import declaration, which is zapo-js's
 * `src/version-spec.ts` and `src/mex.ts` verbatim.
 *
 * The reader resolves to this declaration, which owns no storage, and
 * declTwinGlobalOf hands it the compiled twin's global instead. The %init
 * header has to name the twin too, or that global stays at its C zero
 * value -- NULL for a string, which scr_str_retain dereferences: a crash
 * with no trap, no code and no location. */
export declare const GEN_VERSION: string

export declare const GEN_LIMITS: {
	readonly frame: number
	readonly retries: number
}
