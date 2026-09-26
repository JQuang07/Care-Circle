import type { OrderRequest } from './contracts';
import { ApiError } from './errors';

const TYPES = ['groceries', 'ride', 'gift', 'pharmacy_refill', 'other'];
const bad = (m: string) => new ApiError(400, 'BAD_REQUEST', m);

export function parseOrderRequest(body: unknown): OrderRequest {
  const b = body as Partial<OrderRequest> | null;
  if (!b || typeof b !== 'object') throw bad('Body must be an OrderRequest');
  if (typeof b.seniorId !== 'string' || !b.seniorId.startsWith('sen_')) throw bad('seniorId must be a sen_ id');
  if (!TYPES.includes(b.type as string)) throw bad(`type must be one of ${TYPES.join(', ')}`);
  if (!Number.isInteger(b.amountCents) || (b.amountCents as number) < 0) throw bad('amountCents must be a non-negative integer');
  if (!Array.isArray(b.items)) throw bad('items must be an array');
  for (const i of b.items) {
    if (!i || typeof i.name !== 'string' || !Number.isFinite(i.qty)) throw bad('each item needs name and qty');
    if (i.priceCents !== undefined && !Number.isInteger(i.priceCents)) throw bad('priceCents must be an integer');
  }
  if (!b.context || typeof b.context.transcriptExcerpt !== 'string') throw bad('context.transcriptExcerpt is required');
  for (const k of ['merchantId', 'payeeDescription', 'recipientMemberId'] as const) {
    if (b[k] !== undefined && b[k] !== null && typeof b[k] !== 'string') throw bad(`${k} must be a string`);
  }
  return b as OrderRequest;
}
