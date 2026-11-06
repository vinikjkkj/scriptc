declare class Ring<T = any> {
  length: number;
  constructor();
  size(): number;
  push(item: T): number;
  shift(): T | undefined;
  peek(): T | undefined;
  readonly first: T | undefined;
  label: string;
  cap: number;
  capacity(): number;
}
export = Ring;
