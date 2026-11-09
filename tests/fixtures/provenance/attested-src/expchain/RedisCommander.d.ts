export type Result<T, Context> = Context extends { type: "pipeline" } ? ChainableCommander : Promise<T>;
export interface RedisCommander<Context extends { type: "pipeline" | "default" } = { type: "default" }> {
    get(key: string): Result<string | null, Context>;
    set(key: string, value: string | number): Result<"OK", Context>;
    hset(key: string, field: string, value: string): Result<number, Context>;
    incr(key: string): Result<number, Context>;
    del(...args: [...keys: string[]]): Result<number, Context>;
    del(...args: [keys: string[]]): Result<number, Context>;
}
export type Callback<T = unknown> = (err?: Error | null, result?: T) => void;
export interface ChainableCommander extends RedisCommander<{ type: "pipeline" }> {
    length: number;
    exec(callback?: Callback<[error: Error | null, result: unknown][]>): Promise<[error: Error | null, result: unknown][] | null>;
}
