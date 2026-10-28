import Cl, { Other } from "./cl.ts";

// The ioredis shape: statics DECLARED on the class with no initializer,
// written at module top level after the class statement (Redis.js:826).
export class Redis {
  static Cluster: typeof Cl;
  static Other: typeof Other;
  static defaultOptions: { retries: number };
  static createClient(): Redis {
    return new Redis();
  }
}

export function clusterBeforeInit(): boolean {
  return Redis.Cluster === undefined;
}

export function setOtherLater(): void {
  Redis.Other = Other;
}

Redis.defaultOptions = { retries: 3 };
export default Redis;
