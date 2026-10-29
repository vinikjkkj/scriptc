import { CursorResponse, MongoDBResponse } from './responses.ts';
import { OnDemandDocument } from './document.ts';
const bytes = new Uint8Array([7, 8, 9, 10]);
const c = new CursorResponse(bytes, 1);
console.log(c.describe(), c.batch, c.cachedKeys());
console.log(JSON.stringify(c.toObject()));
const m = new MongoDBResponse(bytes);
console.log(m.get('a'), m.get('zz'), m.size, m instanceof OnDemandDocument);
