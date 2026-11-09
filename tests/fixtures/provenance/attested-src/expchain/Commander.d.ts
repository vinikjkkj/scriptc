import { RedisCommander } from "./RedisCommander";
declare class Commander {
    options: { host?: string };
}
interface Commander extends RedisCommander {}
export default Commander;
