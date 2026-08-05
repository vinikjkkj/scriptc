/* A binding declared in a `.d.ts` MODULE whose implementation twin this
 * build did not compile. Both spellings of "did not compile" are here:
 *
 *   - `outofrealm/index.js` EXISTS beside its declaration and Node loads
 *     it, but its own package.json puts it outside the entry's package
 *     realm, so the declaration-twin hiding declines and the twin never
 *     joins the program;
 *   - `noimpl.d.ts` has no `.js` at all — the data-only declaration module
 *     the 2714/2715 corpus rules map structurally.
 *
 * Every declaration inside a `.d.ts` carries the Ambient modifier, so the
 * `declare const __VERSION__` stance used to swallow these reads whole and
 * compile them to Node's ReferenceError for an undeclared global. That is
 * a WRONG value — Node defines ROWS — and a SILENT one: the build passed
 * clean and the binary died saying the name was never declared. The fence
 * names the real cause, in the same words the method-call fence uses.
 *
 * The controls live where they can be run against Node: the program-file
 * spelling in corpus 1581, the SCRIPT declaration file in corpus 2742.
 */
import { ROWS } from './outofrealm/index.js'
import { DEFAULT_IDENTITY, type Identity } from './noimpl.js'

// Structural use of the same declaration module still maps — the value
// gate is the only thing that closes.
function build(k: number): Identity {
    return { key: k, tag: 'built' }
}

function firstRow(): string {
    return ROWS[0]!.name
}

function moduleDefault(): number {
    return DEFAULT_IDENTITY.key
}

console.log(build(3).tag)
console.log(firstRow())
console.log(moduleDefault())
