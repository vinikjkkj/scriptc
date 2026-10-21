// The TypeScript face of 8022: a class declared inside a function that reads
// typed parameters and consts (numbers, strings, a record, an array), built
// inside a closure of the same function, with a getter and an arrow in a
// method. Each call keeps its own captured values.
interface Options {
  scale: number;
  unit: string;
}

function makeMeter(name: string, opts: Options, marks: number[]): string[] {
  const suffix = `/${opts.unit}`;
  class Meter {
    reading: number;
    constructor(raw: number) {
      this.reading = raw * opts.scale;
    }
    get label(): string {
      return name + suffix;
    }
    marked(): number[] {
      return marks.map((m) => m + this.reading);
    }
    render(): string {
      return `${this.label}=${this.reading}`;
    }
  }
  const build = (raw: number): Meter => new Meter(raw);
  const out: string[] = [build(2).render(), build(3).render()];
  out.push(build(1).marked().join(","));
  return out;
}

console.log(makeMeter("temp", { scale: 10, unit: "C" }, [1, 2]));
console.log(makeMeter("len", { scale: 0.5, unit: "m" }, [100]));
