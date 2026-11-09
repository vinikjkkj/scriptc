import Commander from "./Commander";
import { RedisCommander } from "./RedisCommander";
declare class Pipeline extends Commander {
    constructor(redis: unknown);
    length: number;
    exec(callback?: (err?: Error | null, result?: unknown) => void): Promise<[error: Error | null, result: unknown][] | null>;
}
interface Pipeline extends RedisCommander<{ type: "pipeline" }> {}
export default Pipeline;
