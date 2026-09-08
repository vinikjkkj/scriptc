/* CONTROL for the npm-static namespace answer: zapo's EXACT spelling
 * (`await import(...)` stored into a module-level `let` declared as an
 * interface), but against a LOCAL program module instead of an npm-static
 * package. If this one also answers null, the defect is the stored-namespace
 * lowering. If it answers the module, the defect is npm-static's namespace.
 */
interface LocalModule {
    readonly LOCAL_NUM: number
}

let cached: LocalModule | null | undefined

async function load(): Promise<LocalModule | null> {
    if (cached !== undefined) return cached
    try {
        cached = await import('./locmod.js')
    } catch {
        cached = null
    }
    return cached
}

export async function main(): Promise<void> {
    const m = await load()
    console.log('  loaded = ' + (m === null ? 'null' : 'object'))
    if (m !== null) console.log('  LOCAL_NUM = ' + String(m.LOCAL_NUM))
}
void main()
