export interface TypedParameterValue {
  readonly type: number;
  readonly value: unknown;
  readonly unsigned: boolean;
}
export type ExecuteValues =
  | TypedParameterValue
  | string
  | number
  | bigint
  | boolean
  | Date
  | null
  | Uint8Array
  | ExecuteValues[]
  | readonly unknown[]
  | { [key: string]: ExecuteValues };
export interface Row {
  id: number;
}
export interface ResultSetHeader {
  affectedRows: number;
  insertId: number;
}
export type QueryResult = Row[] | ResultSetHeader | string;
export interface QueryOptions {
  sql: string;
  typeCast?: boolean | ((field: { name: string; type: string }, next: () => unknown) => unknown);
}
declare function ExecutableBase<T extends new (...a: any[]) => object>(Base?: T): {
  new (...args: any[]): {
    execute<R extends QueryResult>(sql: string, values?: ExecuteValues): Promise<[R, string[]]>;
    execute<R extends QueryResult>(options: QueryOptions, values?: ExecuteValues): Promise<[R, string[]]>;
    query<R extends string>(sql: string, values?: ExecuteValues): Promise<[R, string[]]>;
    query<R extends string>(options: QueryOptions, values?: ExecuteValues): Promise<[R, string[]]>;
  };
} & T;
declare class Base {}
export declare class PoolConnection extends ExecutableBase(Base) {
  calls: number;
  readonly probes: number;
  release(): void;
  enablePing(): void;
  disablePing(): void;
}
export interface Pool extends PoolConnection {
  getConnection(): Promise<PoolConnection>;
  end(): Promise<void>;
  count(): number;
}
export declare function createPool(label: string): Pool;
