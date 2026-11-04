import { Base, BaseOptions } from './opts-base';
export interface DerivedOptions extends BaseOptions {
  scaleReads?: "all" | "master" | "slave" | ((n: number) => number) | undefined;
  slotsRefreshInterval?: number | undefined;
  shardedSubscribers?: boolean | undefined;
  redisOptions?: BaseOptions | undefined;
}
export declare class Derived extends Base {
  options: DerivedOptions;
  constructor(options?: DerivedOptions);
  describe(): string;
}
