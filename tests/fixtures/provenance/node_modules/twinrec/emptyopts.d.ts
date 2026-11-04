export interface HolderOptions {
  keyPrefix?: string | undefined;
}
export interface ClusterOptions extends HolderOptions {
  shardedSubscribers?: boolean | undefined;
  slotsRefreshInterval?: number | undefined;
}
export declare class Holder {
  options: HolderOptions;
  reads: number;
  constructor();
  prefixed(key: string): string;
}
export declare class Cluster extends Holder {
  options: ClusterOptions;
  constructor(options?: ClusterOptions);
  describe(): string;
}
