import { XBase } from './base'

export class XSub extends XBase {
    constructor(h: { connect(): unknown }, id: string) { super(h, id) }
    who(): string { return this.id + ':sub' }
}
