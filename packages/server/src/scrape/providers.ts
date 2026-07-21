import { CompanyTypes } from 'israeli-bank-scrapers';

export interface CredentialField {
  key: string;
  label: string;
  type: 'text' | 'password';
}

export interface ScrapeProvider {
  key: string; // our provider key (also the ledger source_provider)
  label: string;
  companyId: string; // israeli-bank-scrapers CompanyTypes value
  sourceType: 'bank' | 'card';
  fields: CredentialField[];
}

// The three the user asked for. Add more from CompanyTypes as needed.
export const SCRAPE_PROVIDERS: ScrapeProvider[] = [
  {
    key: 'yahav',
    label: 'Bank Yahav (בנק יהב)',
    companyId: CompanyTypes.yahav,
    sourceType: 'bank',
    fields: [
      { key: 'username', label: 'Username', type: 'text' },
      { key: 'nationalID', label: 'National ID (ת.ז.)', type: 'text' },
      { key: 'password', label: 'Password', type: 'password' },
    ],
  },
  // Isracard is intentionally omitted from the direct connection — their site
  // aggressively blocks the automated browser (HTTP 403). Import Isracard via a
  // file export (CSV/Excel/PDF) instead.
  {
    key: 'cal',
    label: 'Cal / Visa Cal (כאל)',
    companyId: CompanyTypes.visaCal,
    sourceType: 'card',
    fields: [
      { key: 'username', label: 'Username', type: 'text' },
      { key: 'password', label: 'Password', type: 'password' },
    ],
  },
];

export function getProviderSpec(key: string): ScrapeProvider | undefined {
  return SCRAPE_PROVIDERS.find((p) => p.key === key);
}
