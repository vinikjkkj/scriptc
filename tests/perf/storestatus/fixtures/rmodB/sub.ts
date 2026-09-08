// The subclass, in a DIFFERENT module -- the one variable added over the
// same-file ladder, and the shape every store-redis store class has.
import { RBase } from './base'

export class RSub extends RBase {
    constructor(r: { pipeline(): unknown }, id: string) { super(r, id) }
    who(): string { return this.id + ':sub' }
}
