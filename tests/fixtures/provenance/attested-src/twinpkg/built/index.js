'use strict'
const LIMIT = 7
function twice(n) { return n * 2 }
class Box {
    constructor(v) { this.v = v }
    get() { return this.v }
    static make(n) { return new Box(n) }
    static KIND = 'box'
}
class Other extends Box {
    constructor() { super(LIMIT) }
    tag() { return 'other' + String(this.get()) }
}
exports.LIMIT = LIMIT
exports.twice = twice
exports.Box = Box
exports.Other = Other
