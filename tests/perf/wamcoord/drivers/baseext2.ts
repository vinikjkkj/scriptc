// An ambient class is what an islanded package's type looks like to the
// compiler: a name the checker knows and no compiled declaration behind it.
// No npm package and no island appear anywhere in this file.
declare class Opaque {
    cmd(k: string): string
}

class BaseOpaque {
    protected readonly o: Opaque
    protected readonly id: string
    constructor(o: Opaque, id: string) {
        this.o = o
        this.id = id
    }
}

class SubA extends BaseOpaque {
    key(): string { return this.id + ':a' }
}
class SubB extends BaseOpaque {
    key(): string { return this.id + ':b' }
}

declare const opq: Opaque
console.log('a=' + new SubA(opq, 'x').key())
console.log('b=' + new SubB(opq, 'y').key())
