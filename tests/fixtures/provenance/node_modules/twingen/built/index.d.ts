declare class Ring<T = any> {
  length: number;
  constructor();
  size(): number;
  push(item: T): number;
  shift(): T | undefined;
  peek(): T | undefined;
}
export = Ring;
