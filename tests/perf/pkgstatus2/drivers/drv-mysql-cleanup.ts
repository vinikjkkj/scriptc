// store-mysql/cleanup.ts is the one module of store-mysql whose only import is
// `import type ... from 'zapo-js/store'` — type-only, therefore erased. It
// reaches neither the zapo-js island nor mysql2, in ANY lane.
import { MysqlCleanupPoller } from '../pkgs/store-mysql/cleanup'

function bad(ms: number): string {
    try {
        new MysqlCleanupPoller({ intervalMs: ms })
        return 'no throw'
    } catch (e) {
        return (e as Error).message
    }
}

async function main(): Promise<void> {
    const p = new MysqlCleanupPoller({})
    console.log('1 empty cleanup:', await p.cleanup())

    console.log('2 zero:', bad(0))
    console.log('3 negative:', bad(-5))
    console.log('4 nan:', bad(Number.NaN))
    console.log('5 infinite:', bad(Number.POSITIVE_INFINITY))
    console.log('6 ok:', bad(1000))

    const q = new MysqlCleanupPoller({ intervalMs: 25 })
    q.start()
    q.start()
    q.stop()
    q.stop()
    console.log('7 start/stop idempotent: ok')

    console.log('8 cleanup again:', await q.cleanup())
}
void main()
