import { XBase } from './base'

export class XSub extends XBase {
    constructor(id: string) { super(id) }
    who(): string { return this.id + ':sub' }
}
