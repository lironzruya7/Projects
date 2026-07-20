import assert from 'node:assert/strict';
import { test } from 'node:test';
import { amountsMatch, parseAmount } from './amount.js';
import { detectDateFormat, parseDate } from './date.js';
import { normalizeMerchant, tokenSetRatio } from '../normalize/merchant.js';

test('parseAmount handles Israeli/European formats', () => {
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('₪ 152.90'), 152.9);
  assert.equal(parseAmount('(123.45)'), -123.45);
  assert.equal(parseAmount('123.45-'), -123.45);
  assert.equal(parseAmount('−45'), -45); // unicode minus
  assert.equal(parseAmount('12,50'), 12.5); // comma decimal
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
});

test('amountsMatch respects tolerance', () => {
  assert.ok(amountsMatch(100, 100.4, { tolerancePct: 0.5, toleranceMinor: 1 }));
  assert.ok(!amountsMatch(100, 105, { tolerancePct: 0.5, toleranceMinor: 1 }));
  assert.ok(amountsMatch(-50, -50, { tolerancePct: 0.5, toleranceMinor: 1 }));
});

test('parseDate detects DD/MM vs ISO and Excel serials', () => {
  assert.equal(parseDate('03/05/2025', 'DD/MM/YYYY'), '2025-05-03');
  assert.equal(parseDate('2025-05-03'), '2025-05-03');
  assert.equal(parseDate('25/12/2024'), '2024-12-25'); // unambiguous DD/MM
  assert.equal(parseDate('45000'), '2023-03-15'); // Excel serial
  assert.equal(parseDate('not a date'), null);
});

test('detectDateFormat prefers DD/MM by default', () => {
  assert.equal(detectDateFormat(['01/02/2025', '15/03/2025']), 'DD/MM/YYYY');
  assert.equal(detectDateFormat(['2025-01-02']), 'YYYY-MM-DD');
  assert.equal(detectDateFormat(['13/01/2025', '20/01/2025']), 'DD/MM/YYYY');
});

test('normalizeMerchant strips branch numbers and city suffixes', () => {
  const a = normalizeMerchant('שופרסל דיל תל אביב 1234');
  const b = normalizeMerchant('שופרסל דיל');
  assert.ok(a.includes('שופרסל'));
  assert.ok(!/\d/.test(a));
  // The two should be highly similar after normalization.
  assert.ok(tokenSetRatio(a, b) >= 0.85);
});

test('tokenSetRatio is order-insensitive and threshold-friendly', () => {
  assert.equal(tokenSetRatio('netflix com', 'netflix com'), 1);
  assert.ok(tokenSetRatio('wolt tel aviv', 'wolt') >= 0.85);
  assert.ok(tokenSetRatio('apple store', 'google play') < 0.5);
});
