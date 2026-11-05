export type Chain<T> = { next?: Chain<Chain<T>>; v: number; tag: string };
export interface Opts {
  readonly name: string;
  weird?: Chain<number>;
  readonly count: number;
}
