// The base class alone, in its own module -- BaseRedisStore's shape: a
// type-only import of an islanded package used as a field type.
type Redis = { pipeline(): unknown }

export abstract class RBase {
    protected readonly r: Redis
    protected readonly id: string
    protected constructor(r: Redis, id: string) {
        this.r = r
        this.id = id
    }
}
