import { XBase } from './base'

export class XSub extends XBase {
    constructor(h: { query(): unknown }, id: string) { super(h, id) }
    who(): string { return this.id + ':sub' }
}
