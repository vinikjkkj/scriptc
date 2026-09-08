import { XBase } from './base'

export class XSub extends XBase {
    constructor(h: import('mysql2/promise').Pool, id: string) { super(h, id) }
    who(): string { return this.id + ':sub' }
}
