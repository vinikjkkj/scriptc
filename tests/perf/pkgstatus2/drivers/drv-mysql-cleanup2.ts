// store-mysql/cleanup.ts, driven WITHOUT start(): the one refusal in the
// module ('unref' in this.timer, cleanup.ts:59) is inside start(), which this
// entry never reaches, so it cannot fail the build.
import { MysqlCleanupPoller } from '../pkgs/store-mysql/cleanup'

function bad(ms: number): string {
    try {
        const p = new MysqlCleanupPoller({ intervalMs: ms })
        return `no throw (${typeof p})`
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
    console.log('7 stop before start is a no-op:', (q.stop(), 'ok'))
    console.log('8 cleanup again:', await q.cleanup())
    console.log('9 cleanup is idempotent:', await q.cleanup())
}
void main()
