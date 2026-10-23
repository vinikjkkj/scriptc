export default class Client {
    readonly name: string
    constructor(name: string)
    ping(): string
    static create(name: string): Client
    static instances: number
}
export declare class Sub extends Client {
    constructor()
    ping(): string
    extra(): number
}
