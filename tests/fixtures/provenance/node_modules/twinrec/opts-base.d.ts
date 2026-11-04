export interface BaseOptions {
  keyPrefix?: string | undefined;
  verbose?: boolean | undefined;
}
export declare class Base {
  options: BaseOptions;
  log: string[];
  constructor();
}
