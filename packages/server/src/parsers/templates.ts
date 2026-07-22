import type { AmountMode, ColumnMapping } from '../models/types.js';

/**
 * Keyword dictionaries (HE + EN) used to auto-suggest a column mapping from a
 * header row. Tuned for Bank Yahav, Isracard, and Cal (Visa Cal) exports, but
 * generic enough to guess most Israeli bank/card CSV/XLSX files.
 */
const KEYWORDS = {
  date: ['תאריך עסקה', 'תאריך רכישה', 'תאריך חיוב', 'תאריך ערך', 'תאריך', 'מועד', 'date', 'transaction date'],
  // 'ברוטו'/'נטו' (HE) and 'gross'/'net' (EN) cover PayPal's transaction CSV
  // export. They are listed before the generic 'סכום' so the exact-match pass
  // picks the real amount column instead of partial-matching "סכום משלוח וטיפול"
  // (shipping & handling) in the Hebrew PayPal export.
  amount: ['סכום חיוב', 'סכום העסקה', 'סכום עסקה', 'סכום בש"ח', 'סכום בשח', 'ברוטו', 'נטו', 'סכום', 'amount', 'gross', 'net', 'sum', 'charge'],
  debit: ['חובה', 'חיוב', 'debit'],
  credit: ['זכות', 'credit'],
  merchant: ['שם בית העסק', 'שם בית עסק', 'בית העסק', 'בית עסק', 'שם העסק', 'שם', 'merchant', 'business', 'payee', 'name', 'counterparty'],
  description: ['תיאור פעולה', 'תיאור', 'פרטים', 'פירוט', 'פירוט נוסף', 'הערות', 'description', 'details', 'memo'],
  // The currency of the *charged* amount ("סכום חיוב"). This is what we import.
  chargeCurrency: ['מטבע חיוב', 'מטבע לחיוב', 'charge currency'],
  // The currency of the *original* transaction ("סכום עסקה מקורי") — e.g. $/€ for
  // a foreign purchase. Only relevant when we import that original amount, NOT
  // when we import the ₪ charge, otherwise a ₪ charge gets mislabeled as USD.
  currency: ['מטבע עסקה', 'מטבע', 'currency'],
  type: ['סוג עסקה', 'סוג', 'type'],
  balance: ['יתרה', 'balance'],
  reference: ['מספר זיהוי עיסקה', 'מספר זיהוי עסקה', 'מזהה עסקה', 'מזהה', 'מס שובר', 'שובר', 'אסמכתא', 'מספר עסקה', 'מס עסקה', 'transaction id', 'txn id', 'reference', 'ref'],
} as const;

export interface ProviderTemplate {
  key: string;
  label: string;
  sourceType: 'bank' | 'card';
  /** header cells that, if all present, strongly indicate this provider */
  fingerprint: string[];
  amountMode: AmountMode;
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    // PayPal activity export. Hebrew columns: תאריך / שם / ברוטו / עמלה / נטו /
    // מזהה עסקה. Amounts are signed (negative = money out), so it is a "bank"
    // source with a single signed amount — NOT a card (card mode would flip the
    // sign and turn refunds into charges). Checked first so its distinctive
    // ברוטו/נטו pair wins before the generic single-amount fallback.
    key: 'paypal',
    label: 'PayPal',
    sourceType: 'bank',
    fingerprint: ['ברוטו', 'נטו'],
    amountMode: 'signed',
  },
  {
    key: 'paypal_en',
    label: 'PayPal',
    sourceType: 'bank',
    fingerprint: ['gross', 'net'],
    amountMode: 'signed',
  },
  {
    key: 'yahav',
    label: 'Bank Yahav (בנק יהב)',
    sourceType: 'bank',
    fingerprint: ['חובה', 'זכות'],
    amountMode: 'debit_credit',
  },
  {
    // Cal exports carry a "ענף" (business sector) column and have no separate
    // currency column — the ₪ symbol is inline in "סכום חיוב". Checked before
    // Isracard so the more specific signal wins.
    key: 'cal',
    label: 'Cal / Visa Cal (כאל)',
    sourceType: 'card',
    fingerprint: ['ענף', 'סכום חיוב'],
    amountMode: 'flip_sign',
  },
  {
    // Isracard exports carry a "מטבע חיוב" (charged currency) column; Cal does not.
    key: 'isracard',
    label: 'Isracard (ישראכרט)',
    sourceType: 'card',
    fingerprint: ['שם בית עסק', 'מטבע חיוב'],
    amountMode: 'flip_sign', // card charges are positive magnitudes = outflow
  },
];

function norm(s: string): string {
  return s.toLowerCase().replace(/["'״׳]/g, '').replace(/\s+/g, ' ').trim();
}

function findColumn(header: string[], keywords: readonly string[]): string | null {
  const normHeader = header.map((h) => ({ raw: h, n: norm(h) }));
  // Prefer exact keyword match, then longest-keyword substring match.
  for (const kw of keywords) {
    const nk = norm(kw);
    const exact = normHeader.find((h) => h.n === nk);
    if (exact) return exact.raw;
  }
  for (const kw of keywords) {
    const nk = norm(kw);
    const partial = normHeader.find((h) => h.n.includes(nk));
    if (partial) return partial.raw;
  }
  return null;
}

export interface MappingSuggestion {
  mapping: ColumnMapping;
  amountMode: AmountMode;
  provider: string | null;
  sourceType: 'bank' | 'card';
  confidence: number; // 0..1
}

/** Suggest a column mapping + amount mode from a header row. */
export function suggestMapping(header: string[]): MappingSuggestion {
  const normHeader = header.map(norm);

  // Try provider fingerprints first.
  let provider: ProviderTemplate | null = null;
  for (const t of PROVIDER_TEMPLATES) {
    if (t.fingerprint.every((fp) => normHeader.some((h) => h.includes(norm(fp))))) {
      provider = t;
      break;
    }
  }

  const debit = findColumn(header, KEYWORDS.debit);
  const credit = findColumn(header, KEYWORDS.credit);
  const amount = findColumn(header, KEYWORDS.amount);
  const merchant = findColumn(header, KEYWORDS.merchant);
  const description = findColumn(header, KEYWORDS.description);

  // Pick the currency column that matches the amount we actually import.
  // We import the *charged* amount ("סכום חיוב"), so its currency is the charge
  // currency (usually ₪). Only fall back to the original-transaction currency
  // ("מטבע עסקה"/"מטבע") when the amount is NOT a charge column — otherwise a ₪
  // charge on a foreign purchase would be mislabeled with the original currency.
  const chargeCurrency = findColumn(header, KEYWORDS.chargeCurrency);
  const amountIsCharge = Boolean(amount && /חיוב/.test(amount));
  const currency = chargeCurrency ?? (amountIsCharge ? null : findColumn(header, KEYWORDS.currency));

  const mapping: ColumnMapping = {
    date: findColumn(header, KEYWORDS.date),
    amount: amount,
    debit: debit,
    credit: credit,
    merchant: merchant,
    description: description ?? merchant,
    currency,
    type: findColumn(header, KEYWORDS.type),
    reference: findColumn(header, KEYWORDS.reference),
  };

  let amountMode: AmountMode;
  let sourceType: 'bank' | 'card';
  if (provider) {
    amountMode = provider.amountMode;
    sourceType = provider.sourceType;
  } else if (debit && credit) {
    amountMode = 'debit_credit';
    sourceType = 'bank';
  } else {
    // A lone amount column: assume signed for banks. Cards are handled via
    // provider detection; unknown single-column files default to signed.
    amountMode = 'signed';
    sourceType = 'bank';
  }

  // Confidence: did we find date + (amount or debit/credit) + a name column?
  const haveDate = Boolean(mapping.date);
  const haveAmount = Boolean(amount || (debit && credit));
  const haveName = Boolean(merchant || description);
  const confidence =
    (haveDate ? 0.4 : 0) + (haveAmount ? 0.4 : 0) + (haveName ? 0.2 : 0) + (provider ? 0.0 : 0);

  return { mapping, amountMode, provider: provider?.key ?? null, sourceType, confidence };
}
