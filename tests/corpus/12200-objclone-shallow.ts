// Clone of a class instance by the Object.create idiom: same class, every
// own field copied, object-valued fields shared (shallow).
class Config {
  host: string;
  port: number;
  flags: string[];
  opts: { ssl: boolean; level: number };
  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
    this.flags = ["a", "b"];
    this.opts = { ssl: false, level: 1 };
  }
  url(): string {
    return `${this.host}:${this.port}`;
  }
  bump(): number {
    this.port = this.port + 1;
    return this.port;
  }
}

function cloneConfig(c: Config): Config {
  return Object.create(Object.getPrototypeOf(c), Object.getOwnPropertyDescriptors(c));
}

const orig = new Config("db", 3306);
const copy = cloneConfig(orig);
console.log(copy instanceof Config, orig instanceof Config);
console.log(copy.url(), copy === orig);
console.log(copy.bump(), orig.port);
copy.port = 4000;
copy.host = "replica";
console.log(orig.url(), copy.url());
copy.flags.push("c");
copy.opts.level = 9;
console.log(orig.flags.join(","), orig.opts.level, copy.flags === orig.flags, copy.opts === orig.opts);
console.log(Object.keys(copy).join(" "));
console.log(Object.keys(copy).join(" ") === Object.keys(orig).join(" "));
console.log(JSON.stringify({ host: copy.host, port: copy.port, flags: copy.flags }));
console.log(JSON.stringify({ host: orig.host, port: orig.port }) === JSON.stringify({ host: copy.host, port: copy.port }));
