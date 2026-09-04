// Outside the cluster. The body returns a closure and calls nothing.
export function makeTagger(name: string): (n: number) => string {
  return function tagger(n: number): string {
    return name + "#" + n;
  };
}
