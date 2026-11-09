import Commander from "./Commander";
import { RedisCommander } from "./RedisCommander";
import type { ChainableCommander } from "./RedisCommander";
declare class Redis extends Commander {
    constructor(options?: { host?: string });
    sent: number;
    pipeline(): ChainableCommander;
    multi(options: { pipeline: false }): Promise<"OK">;
    multi(): ChainableCommander;
    multi(commands?: unknown[][]): ChainableCommander;
}
export default Redis;
