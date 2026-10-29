import { OnDemandDocument } from './document.ts';
export class MongoDBResponse extends OnDemandDocument {
  describe(): string {
    return 'size=' + this.size;
  }
}
export class CursorResponse extends MongoDBResponse {
  readonly batch = 2;
}
