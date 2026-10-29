import { AbstractOperation } from './operation.ts';
import { MongoDBResponse } from './responses.ts';
export class CountOp extends AbstractOperation<number> {
  SERVER_COMMAND_RESPONSE_TYPE = MongoDBResponse;
  finish(doc: Record<string, unknown>): number {
    return (doc.size as number) + ((doc.a as number | undefined) ?? 0);
  }
}
export class NameOp extends AbstractOperation<string> {
  SERVER_COMMAND_RESPONSE_TYPE = MongoDBResponse;
  finish(doc: Record<string, unknown>): string {
    return JSON.stringify(doc);
  }
}
