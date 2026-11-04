export interface Options { sharded?: boolean | undefined }
export declare class Cluster {
  constructor(options: Options);
  go(): Promise<any[]>;
  halt(): number;
  breakIt(): number;
}
