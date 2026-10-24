export interface Chain<M extends "a" | "b" = "a"> {
  length: number;
  argrep(...args: [key: string, ...rest: string[], cb: (e: unknown, r: number) => void]): Chain<M>;
  argrep<T extends string[]>(...args: [key: string, ...args: T]): Chain<M>;
}
