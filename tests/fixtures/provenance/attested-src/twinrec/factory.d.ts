export interface Param {
  type: number;
  value: number | null;
  unsigned: boolean;
}
export declare function make(name: string, value: number | null): Param;
export declare function makeUnsigned(name: string, value: number | null): Param;
export declare function hasUnsigned(name: string): boolean;
export declare function names(): string[];
