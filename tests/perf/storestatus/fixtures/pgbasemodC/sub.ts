import { XBase } from './base'

export class XSub extends XBase {
    constructor(h: import('pg').Pool, id: string) { super(h, id) }
    who(): string { return this.id + ':sub' }
}
