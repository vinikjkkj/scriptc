// The cross-MODULE spelling of 7490/7491. Same three things asserted --
// the type resolves, the erased union narrows back, and the value keeps its
// own representation (identity out of the transaction, writes visible both
// ways) -- with the alias declared in one module and used in another, which
// is how zapo actually spells it.
import { log } from './connection.ts'
import { BaseSqliteStore } from './store.ts'

interface PreKeyRecord {
    keyId: number
    privKey: string
    uploaded: boolean | undefined
}

interface Reservation {
    available: PreKeyRecord[]
    reservedKeyIds: number[]
}

const storedKey: PreKeyRecord = { keyId: 7, privKey: 'k', uploaded: true }

class PreKeyStore extends BaseSqliteStore {
    public async consume(hit: boolean): Promise<PreKeyRecord | null> {
        return this.withTransaction((db) => {
            db.run('SELECT prekey')
            return hit ? storedKey : null
        })
    }

    public async reserve(): Promise<Reservation> {
        return this.withTransaction((db) => {
            db.run('SELECT reservation')
            return { available: [storedKey], reservedKeyIds: [1, 2] }
        })
    }

    public async many(): Promise<PreKeyRecord[]> {
        return this.withTransaction((db) => {
            db.run('SELECT prekeys')
            return [storedKey]
        })
    }

    public async count(): Promise<number> {
        return this.withTransaction((db) => {
            db.run('SELECT count')
            return 3
        })
    }

    public async label(): Promise<string> {
        return this.withTransaction((db) => {
            db.run('SELECT label')
            return 'ok'
        })
    }

    public async migrate(): Promise<void> {
        await this.withTransaction((db) => {
            db.run('INSERT migration')
        })
    }
}

async function main(): Promise<void> {
    const store = new PreKeyStore()

    const hit = await store.consume(true)
    console.log('identity out of the transaction', hit === storedKey)
    if (hit !== null) {
        hit.privKey = 'rotated'
    }
    console.log('write through the returned record', storedKey.privKey)
    storedKey.uploaded = false
    console.log('read after a write through the original', hit === null ? 'null' : String(hit.uploaded))

    console.log('miss', await store.consume(false))
    console.log('reserve', JSON.stringify(await store.reserve()))
    console.log('many', JSON.stringify(await store.many()))
    console.log('count', await store.count())
    console.log('label', await store.label())

    await store.migrate()
    console.log('void instantiation returned')

    console.log(log.join('|'))
}

void main()
