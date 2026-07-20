import { getDb, nowIso } from '../db/db.js';
import { ColumnMapping, type MappingConfig } from '../models/types.js';

interface MappingRow {
  signature: string;
  provider: string | null;
  source_type: string | null;
  mapping_json: string;
  date_format: string | null;
  amount_mode: string | null;
  header_row: number;
  label: string | null;
  created_at: string;
  updated_at: string;
}

export function getMapping(signature: string): MappingConfig | null {
  const row = getDb().prepare(`SELECT * FROM column_mappings WHERE signature = ?`).get(signature) as
    | MappingRow
    | undefined;
  if (!row) return null;
  return {
    signature: row.signature,
    provider: row.provider,
    sourceType: (row.source_type as 'bank' | 'card') ?? 'bank',
    mapping: ColumnMapping.parse(JSON.parse(row.mapping_json)),
    dateFormat: row.date_format,
    amountMode: (row.amount_mode as MappingConfig['amountMode']) ?? 'signed',
    headerRow: row.header_row,
    label: row.label,
  };
}

export function saveMapping(cfg: MappingConfig): void {
  getDb()
    .prepare(
      `INSERT INTO column_mappings
         (signature, provider, source_type, mapping_json, date_format, amount_mode, header_row, label, created_at, updated_at)
       VALUES (@signature, @provider, @source_type, @mapping_json, @date_format, @amount_mode, @header_row, @label, @now, @now)
       ON CONFLICT(signature) DO UPDATE SET
         provider = @provider, source_type = @source_type, mapping_json = @mapping_json,
         date_format = @date_format, amount_mode = @amount_mode, header_row = @header_row,
         label = @label, updated_at = @now`,
    )
    .run({
      signature: cfg.signature,
      provider: cfg.provider ?? null,
      source_type: cfg.sourceType,
      mapping_json: JSON.stringify(cfg.mapping),
      date_format: cfg.dateFormat ?? null,
      amount_mode: cfg.amountMode,
      header_row: cfg.headerRow ?? 0,
      label: cfg.label ?? null,
      now: nowIso(),
    });
}

export function listMappings(): MappingConfig[] {
  const rows = getDb().prepare(`SELECT * FROM column_mappings ORDER BY updated_at DESC`).all() as MappingRow[];
  return rows.map((row) => ({
    signature: row.signature,
    provider: row.provider,
    sourceType: (row.source_type as 'bank' | 'card') ?? 'bank',
    mapping: ColumnMapping.parse(JSON.parse(row.mapping_json)),
    dateFormat: row.date_format,
    amountMode: (row.amount_mode as MappingConfig['amountMode']) ?? 'signed',
    headerRow: row.header_row,
    label: row.label,
  }));
}
