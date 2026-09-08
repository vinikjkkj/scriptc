// Minimal reproduction ladder for "extending classes not declared in the
// program". Two probes already FAILED to reproduce it without an island (a
// bigint field, an ambient `declare class` field), so this asks whether an
// actual islanded package type is what does it, and which other feature of
// BaseRedisStore's shape is load-bearing.
//
// The type-only import is deliberate: it is what BaseRedisStore writes, so no
// runtime value of the islanded package crosses into these classes.
import type Redis from 'ioredis'

// 1. plain base, field typed by the islanded package, subclass in the SAME file
class Plain {
    protected readonly r: Redis
    constructor(r: Redis) { this.r = r }
}
class SubPlain extends Plain {
    who(): string { return 'plain' }
}

// 2. the same, but ABSTRACT with a PROTECTED constructor -- BaseRedisStore's shape
abstract class Abs {
    protected readonly r: Redis
    protected constructor(r: Redis) { this.r = r }
}
class SubAbs extends Abs {
    constructor(r: Redis) { super(r) }
    who(): string { return 'abs' }
}

declare const rr: Redis
console.log('a=' + new SubPlain(rr).who())
console.log('b=' + new SubAbs(rr).who())
