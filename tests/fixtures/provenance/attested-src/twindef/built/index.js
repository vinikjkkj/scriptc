'use strict'
class Client {
    constructor(name) { this.name = name; Client.instances = Client.instances + 1 }
    ping() { return 'pong:' + this.name }
    static create(name) { return new Client(name) }
    static instances = 0
}
class Sub extends Client {
    constructor() { super('sub') }
    ping() { return 'sub-' + super.ping() }
    extra() { return 5 }
}
exports.default = Client
exports.Sub = Sub
