// ARM D. The islanded type appears ONLY as a METHOD PARAMETER, never as a
// field. Arm A puts the same type in a field and the class becomes
// undeclarable. If D reads zero, the field is the load-bearing position and
// the 14 store files that import the same type for a method parameter are
// NOT what blocks these packages.
import type { Pool } from 'mysql2/promise'

export abstract class XBase {
    protected readonly id: string
    protected constructor(id: string) { this.id = id }
    protected tag(h: Pool): string { return this.id + (typeof h) }
}
