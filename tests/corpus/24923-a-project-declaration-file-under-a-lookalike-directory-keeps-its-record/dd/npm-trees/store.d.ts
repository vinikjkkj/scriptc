export interface Finder {
  find<T extends string>(key: T, ...more: [T, ...string[]]): T;
  hit(id: number): boolean;
}
