import { RBase } from './base'

export class RSub extends RBase {
    constructor(id: string) { super(id) }
    who(): string { return this.id + ':sub' }
}
