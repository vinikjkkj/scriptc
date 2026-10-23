export type ExecuteValues = any | any[] | { [param: string]: any };
export interface Row {
  id: number;
}
export type QueryResult = Row[] | string;
declare function ExecutableBase<T extends new (...a: any[]) => object>(Base?: T): {
  new (...args: any[]): {
    execute<R extends QueryResult>(sql: string, values?: ExecuteValues): Promise<[R, string[]]>;
    execute<R extends QueryResult>(options: { sql: string }, values?: ExecuteValues): Promise<[R, string[]]>;
  };
} & T;
declare class Base {}
export declare class Pool extends ExecutableBase(Base) {
  count(): number;
}
export declare function createPool(label: string): Pool;
