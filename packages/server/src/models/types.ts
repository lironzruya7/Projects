import { z } from 'zod';

export const SourceType = z.enum(['email', 'bank', 'card']);
export type SourceType = z.infer<typeof SourceType>;

export const CategorySource = z.enum(['rule', 'manual', 'llm', 'none']);
export type CategorySource = z.infer<typeof CategorySource>;

/**
 * A parsed record before it is persisted. This is the Zod boundary: every row
 * coming out of a parser MUST validate against this or we fail loudly.
 * `amount` is signed (negative = outflow).
 */
export const ParsedTransaction = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be ISO yyyy-mm-dd'),
  postedAt: z.string().nullable().optional(),
  amount: z.number().finite(),
  currency: z.string().min(1),
  merchantRaw: z.string().default(''),
  description: z.string().default(''),
  sourceType: SourceType,
  sourceProvider: z.string().nullable().optional(),
  sourceRef: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
  rawAmount: z.string().nullable().optional(),
  raw: z.record(z.unknown()).nullable().optional(),
});
export type ParsedTransaction = z.infer<typeof ParsedTransaction>;

/** A persisted transaction row as returned by the API. */
export const Transaction = z.object({
  id: z.string(),
  date: z.string(),
  postedAt: z.string().nullable(),
  amount: z.number(),
  currency: z.string(),
  merchantRaw: z.string(),
  merchantNormalized: z.string(),
  description: z.string(),
  category: z.string().nullable(),
  categorySource: CategorySource,
  sourceType: SourceType,
  sourceProvider: z.string().nullable(),
  sourceRef: z.string().nullable(),
  externalId: z.string().nullable(),
  importBatch: z.string().nullable(),
  rawAmount: z.string().nullable(),
  mergedInto: z.string().nullable(),
  createdAt: z.string(),
});
export type Transaction = z.infer<typeof Transaction>;

/** A user-facing ledger row = a primary transaction plus its merged sources. */
export interface LedgerEntry extends Transaction {
  sources: Transaction[]; // includes the primary itself
  sourceCount: number;
  sourceTypes: SourceType[];
}

export const ColumnMapping = z.object({
  date: z.string().nullable().optional(),
  amount: z.string().nullable().optional(),
  debit: z.string().nullable().optional(),
  credit: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  merchant: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
});
export type ColumnMapping = z.infer<typeof ColumnMapping>;

export const AmountMode = z.enum(['signed', 'debit_credit', 'magnitude_type', 'flip_sign']);
export type AmountMode = z.infer<typeof AmountMode>;

export const MappingConfig = z.object({
  signature: z.string(),
  provider: z.string().nullable().optional(),
  sourceType: z.enum(['bank', 'card']),
  mapping: ColumnMapping,
  dateFormat: z.string().nullable().optional(),
  amountMode: AmountMode,
  headerRow: z.number().int().min(0).default(0),
  label: z.string().nullable().optional(),
});
export type MappingConfig = z.infer<typeof MappingConfig>;

export const DedupSettings = z.object({
  amountTolerancePct: z.number().min(0),
  amountToleranceMinor: z.number().min(0),
  dateWindowDays: z.number().int().min(0),
  merchantThreshold: z.number().min(0).max(1),
});
export type DedupSettings = z.infer<typeof DedupSettings>;
