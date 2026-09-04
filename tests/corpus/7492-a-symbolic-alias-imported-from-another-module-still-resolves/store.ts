// zapo store-sqlite's BaseSqliteStore.ts: the alias is IMPORTED here, and
// that import is the whole point of this program. The instantiation side
// table is keyed by the ts.Type the DECLARATION's own type node produced;
// across a module boundary the body asks about a DIFFERENT ts.Type object
// that prints the same and means the same, so an identity-only lookup
// missed and `Promise<NonPromise<T>>` stopped mapping at the return below.
import { type NonPromise, openSqliteConnection, type WaSqliteConnection } from './connection.ts'

export abstract class BaseSqliteStore {
    private connection: WaSqliteConnection | null = null

    protected async getConnection(): Promise<WaSqliteConnection> {
        if (!this.connection) {
            this.connection = openSqliteConnection()
        }
        return this.connection
    }

    protected async withTransaction<T>(
        run: (connection: WaSqliteConnection) => NonPromise<T>
    ): Promise<NonPromise<T>> {
        const db = await this.getConnection()
        return db.runInTransaction(() => run(db))
    }
}
