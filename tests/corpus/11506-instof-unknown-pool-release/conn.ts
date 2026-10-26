export class PoolConnection {
  released = 0;
  release(): void {
    this.released++;
  }
}
export class Other {
  released = 0;
}
