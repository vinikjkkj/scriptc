// zapo store-sqlite's connection.ts: the conditional alias, the callback
// alias written over it, and the interface member with the bare `<T>`.
export type NonPromise<T> = T extends PromiseLike<unknown> ? never : T
export type SqliteTransactionTask<T> = () => NonPromise<T>

export interface WaSqliteConnection {
    run(sql: string): void
    runInTransaction<T>(run: SqliteTransactionTask<T>): Promise<NonPromise<T>>
}

export const log: string[] = []

export function openSqliteConnection(): WaSqliteConnection {
    const run = (sql: string): void => {
        log.push(sql)
    }
    return {
        run,
        async runInTransaction<T>(task: SqliteTransactionTask<T>): Promise<NonPromise<T>> {
            run('BEGIN')
            const result: NonPromise<T> = task()
            run('COMMIT')
            return result
        }
    }
}
