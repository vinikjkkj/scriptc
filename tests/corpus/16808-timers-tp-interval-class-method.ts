import * as tp from 'timers/promises';

// The loop inside a class method, with `this` and a returned count; and an
// async arrow whose loop returns from inside the body.
class Ticker {
  count = 0;
  async run(limit: number): Promise<number> {
    for await (const v of tp.setInterval(4, `t${limit}`)) {
      this.count++;
      console.log('tick', v, this.count);
      if (this.count >= limit) break;
    }
    return this.count;
  }
}

async function main() {
  const t = new Ticker();
  console.log('result', await t.run(3));
  const u = await (async () => {
    let total = 0;
    for await (const _ of tp.setInterval(2)) {
      total += 1;
      if (total === 2) return total * 10;
    }
    return -1;
  })();
  console.log('u', u);
}
main();
