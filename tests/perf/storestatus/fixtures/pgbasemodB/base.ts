// Same 26-line shape as rmod, with the driver swapped. The question is
// whether an islanded type in a field behaves identically regardless of WHY
// the package islands: ioredis publishes no attestation, pg publishes none,
// and mysql2 IS attested but its 'mysql2/promise' subpath does not map.
type Pool = { connect(): unknown }

export abstract class XBase {
    protected readonly h: Pool
    protected readonly id: string
    protected constructor(h: Pool, id: string) {
        this.h = h
        this.id = id
    }
}
