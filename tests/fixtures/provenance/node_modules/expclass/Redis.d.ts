export interface Chain {
    get(key: string): Chain;
    exec(): string[];
}
declare class Redis {
    opts: { host: string };
    calls: number;
    constructor(opts: { host: string });
    get(key: string): string;
    ping(): string;
    pipeline(): Chain;
}
export default Redis;
