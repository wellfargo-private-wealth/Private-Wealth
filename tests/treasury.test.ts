import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

interface ClientRecord {
  id: string;
  username: string;
  password: string;
  full_name: string;
  email: string;
  phone: string;
  address: string;
  account_tier: string;
  account_number: string;
  routing_code: string;
  balance_usd: number;
  deposit_usd: number;
  debit_usd: number;
  investment_usd: number;
  loan_usd: number;
  card_number: string;
  card_cvv: string;
  card_expiry: string;
  card_frozen: boolean;
  account_status: string;
  avatar_url: string;
  transactions_json: Array<{ id: string; date: string; counterparty: string; memo: string; rail: string; type: string; status: string; amountUSD: number }>;
  created_at: string;
}

interface TreasuryCoreApi {
  ACCOUNT_HOLDER: string;
  ACCOUNT_USERNAME: string;
  ACCOUNT_LAST_NAME: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD: string;
  MIN_ADMIN_START_BALANCE_USD: number;
  getDynamicGreeting: (hour: number) => string;
  isSupabaseConfigured: (url: string, key: string) => boolean;
  convertFromUSD: (amountUSD: number, currencyCode: string) => number;
  convertBetweenCurrencies: (amount: number, fromCode: string, toCode: string) => number;
  formatCurrency: (amountUSD: number, currencyCode: string, options?: { showPlus?: boolean; decimals?: number }) => string;
  formatAccountNumber: (rawNumber: string, masked: boolean) => string;
  formatCardNumber: (rawNumber: string, masked: boolean) => string;
  sanitizeAvatarUrl: (url: string) => string;
  createSeedTimothyTownsend: () => ClientRecord;
  authenticatePortal: (username: string, password: string, clients: ClientRecord[]) => { ok: boolean; role?: string; client?: ClientRecord; error?: string };
  validateTransferStep1: (
    input: { bankName: string; beneficiary: string; routing: string; accountNum: string; amount: string | number; memo: string },
    availableBalanceUSD: number,
    holderName?: string
  ) => { valid: boolean; error: string };
  validateCotCode: (code: string) => boolean;
  validateSecurityPin: (pin: string) => boolean;
  applyCompletedTransfer: (
    state: {
      availableBalanceUSD: number;
      totalDepositUSD: number;
      totalDebitUSD: number;
      investmentUSD: number;
      loanUSD: number;
      transactions: Array<{ id: string; date: string; counterparty: string; memo: string; rail: string; type: string; status: string; amountUSD: number }>;
    },
    transferDetails: { rail: string; bankName: string; beneficiary: string; memo: string; amount: number },
    refId: string,
    dateStr: string
  ) => {
    availableBalanceUSD: number;
    totalDepositUSD: number;
    totalDebitUSD: number;
    investmentUSD: number;
    loanUSD: number;
    transactions: Array<{ id: string; date: string; counterparty: string; memo: string; rail: string; type: string; status: string; amountUSD: number }>;
  };
  filterTransactions: (
    transactions: Array<{ id: string; counterparty: string; memo: string; rail: string; type: string }>,
    filterType: string,
    searchQuery: string
  ) => Array<{ id: string }>;
  generateStrongPassword: (length?: number) => string;
  generateRandomBalanceUSD: () => number;
  buildNewClientRecord: (input: Record<string, unknown>, existingClients: ClientRecord[]) => { ok: boolean; client?: ClientRecord; error?: string };
  applyAdminBalanceAdjustment: (client: ClientRecord, mode: string, amountUSD: number, memo: string, dateStr?: string) => { ok: boolean; client?: ClientRecord; error?: string };
  computeAdminKPIs: (clients: ClientRecord[]) => { totalLiquidityUSD: number; activeClientsCount: number; frozenCardsCount: number };
}

function loadTreasuryCoreFromHtml(): TreasuryCoreApi {
  const htmlPath = path.resolve(process.cwd(), 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const match = html.match(/<script id="treasury-core-logic">([\s\S]*?)<\/script>/);
  assert.ok(match && match[1], 'Expected treasury-core-logic script tag inside index.html');
  const sandbox: { globalThis: Record<string, unknown> } = { globalThis: {} };
  vm.runInNewContext(match[1], sandbox);
  return sandbox.globalThis.TreasuryCore as TreasuryCoreApi;
}

const Core = loadTreasuryCoreFromHtml();

test('dynamic greeting matches time of day', () => {
  assert.equal(Core.getDynamicGreeting(8), 'Good morning');
  assert.equal(Core.getDynamicGreeting(14), 'Good afternoon');
  assert.equal(Core.getDynamicGreeting(20), 'Good evening');
});

test('currency conversion and formatting use exact USD/GBP/EUR rates', () => {
  assert.equal(Core.convertFromUSD(1000, 'USD'), 1000);
  assert.equal(Core.convertFromUSD(1000, 'GBP'), 790);
  assert.equal(Core.convertFromUSD(1000, 'EUR'), 920);
  assert.equal(Core.formatCurrency(30000000, 'USD'), '$30,000,000.00');
  assert.equal(Core.formatCurrency(1000, 'GBP'), '£790.00');
  assert.equal(Core.formatCurrency(1000, 'EUR'), '€920.00');
  assert.equal(Math.round(Core.convertBetweenCurrencies(790, 'GBP', 'EUR')), 920);
});

test('account number and debit card masking/unmasking', () => {
  assert.equal(Core.formatAccountNumber('449088210934', true), '•••• •••• 0934');
  assert.equal(Core.formatAccountNumber('449088210934', false), '4490 8821 0934');
  assert.equal(Core.formatCardNumber('5399482011934829', true), '5399 •••• •••• 4829');
  assert.equal(Core.formatCardNumber('5399482011934829', false), '5399 4820 1193 4829');
});

test('supabase placeholder detection and role-based sign-on authentication', () => {
  assert.equal(Core.isSupabaseConfigured(Core.SUPABASE_URL, Core.SUPABASE_ANON_KEY), false);
  assert.equal(Core.isSupabaseConfigured('https://demo-proj.supabase.co', 'anon-key-123'), true);

  const seed = Core.createSeedTimothyTownsend();
  assert.equal(seed.balance_usd, 30000000);
  assert.equal(seed.routing_code, 'MRDNUS33XXX');
  assert.equal(seed.email, 't.townsend@privatewealth.com');

  const adminRes = Core.authenticatePortal('MASTER.ADMIN', 'AdminMaster2026!', [seed]);
  assert.equal(adminRes.ok, true);
  assert.equal(adminRes.role, 'admin');

  const clientRes = Core.authenticatePortal('Timothy.Townsend', 'Treasury2026!', [seed]);
  assert.equal(clientRes.ok, true);
  assert.equal(clientRes.role, 'client');
  assert.equal(clientRes.client?.full_name, 'Timothy Townsend');

  const badRes = Core.authenticatePortal('timothy.townsend', 'wrongpass', [seed]);
  assert.equal(badRes.ok, false);
  assert.equal(badRes.error, 'Invalid username or password. Please verify your credentials.');
});

test('transfer step 1 validation enforces required fields and balance cap', () => {
  const missing = Core.validateTransferStep1(
    { bankName: '', beneficiary: 'Acme', routing: '021000021', accountNum: '123456', amount: 500, memo: 'Test' },
    30000000
  );
  assert.equal(missing.valid, false);

  const overLimit = Core.validateTransferStep1(
    { bankName: 'Chase', beneficiary: 'Acme', routing: '021000021', accountNum: '123456', amount: 35000000, memo: 'Test' },
    30000000
  );
  assert.equal(overLimit.valid, false);
  assert.match(overLimit.error, new RegExp(Core.ACCOUNT_HOLDER));

  const valid = Core.validateTransferStep1(
    { bankName: 'Chase', beneficiary: 'Acme', routing: '021000021', accountNum: '123456', amount: 250000, memo: 'Q4 Settlement' },
    30000000
  );
  assert.equal(valid.valid, true);
});

test('COT and PIN gate validators check exact authorization codes', () => {
  assert.equal(Core.validateCotCode('COT-8842'), true);
  assert.equal(Core.validateCotCode('cot-8842 '), true);
  assert.equal(Core.validateCotCode('COT-0000'), false);

  assert.equal(Core.validateSecurityPin('2026'), true);
  assert.equal(Core.validateSecurityPin('1234'), false);
});

test('completed transfer deducts available balance, increases debit, and prepends ledger entry', () => {
  const initial = {
    availableBalanceUSD: 30000000.0,
    totalDepositUSD: 38450000.0,
    totalDebitUSD: 8450000.0,
    investmentUSD: 12500000.0,
    loanUSD: 1200000.0,
    transactions: [
      { id: 'TXN-1', date: '2026-11-20', counterparty: 'Existing', memo: 'Old', rail: 'ACH Transfer', type: 'deposit', status: 'Completed', amountUSD: 1000 },
    ],
  };

  const next = Core.applyCompletedTransfer(
    initial,
    { rail: 'Wire Transfer', bankName: 'Citibank N.A.', beneficiary: 'Townsend Holdings', memo: 'Capital Call', amount: 500000 },
    'TXN-999001',
    '2026-11-23'
  );

  assert.equal(next.availableBalanceUSD, 29500000.0);
  assert.equal(next.totalDebitUSD, 8950000.0);
  assert.equal(next.transactions.length, 2);
  assert.equal(next.transactions[0].id, 'TXN-999001');
  assert.equal(next.transactions[0].status, 'Completed');
  assert.equal(next.transactions[0].type, 'debit');
  assert.equal(next.transactions[0].amountUSD, 500000);
});

test('admin client provisioning enforces $650k minimum, uniqueness, balance adjustments, and KPIs', () => {
  const seed = Core.createSeedTimothyTownsend();

  const tooLow = Core.buildNewClientRecord(
    {
      full_name: 'Alice Vance',
      username: 'alice.vance',
      password: 'Password2026!',
      email: 'alice@example.com',
      phone: '555-0100',
      address: '100 Main St',
      account_tier: 'Global Reserve',
      balance_usd: 500000,
    },
    [seed]
  );
  assert.equal(tooLow.ok, false);
  assert.match(tooLow.error || '', /650,000/);

  const randBal = Core.generateRandomBalanceUSD();
  assert.ok(randBal >= 650000 && randBal <= 35000000);
  assert.ok(Core.generateStrongPassword(14).length >= 14);

  const created = Core.buildNewClientRecord(
    {
      full_name: 'Victoria Sterling',
      username: 'Victoria.Sterling',
      password: 'Password2026!',
      email: 'v.sterling@privatewealth.com',
      phone: '+1 212 555 0177',
      address: '55 Wall St, New York, NY',
      account_tier: 'Corporate Treasury',
      balance_usd: 2000000,
    },
    [seed]
  );
  assert.equal(created.ok, true);
  assert.ok(created.client);
  assert.equal(created.client.username, 'victoria.sterling');
  assert.equal(created.client.balance_usd, 2000000);

  const adjusted = Core.applyAdminBalanceAdjustment(created.client, 'credit', 500000, 'Capital Injection', '2026-11-27');
  assert.equal(adjusted.ok, true);
  assert.equal(adjusted.client?.balance_usd, 2500000);

  const kpis = Core.computeAdminKPIs([seed, { ...adjusted.client!, card_frozen: true }]);
  assert.equal(kpis.activeClientsCount, 2);
  assert.equal(kpis.frozenCardsCount, 1);
  assert.equal(kpis.totalLiquidityUSD, 32500000);
});

test('avatar sanitization blocks javascript schemes and allows safe data/local paths', () => {
  assert.equal(Core.sanitizeAvatarUrl('javascript:alert(1)'), '');
  assert.equal(Core.sanitizeAvatarUrl('./profile.jpg'), './profile.jpg');
  assert.equal(Core.sanitizeAvatarUrl('data:image/jpeg;base64,abc123'), 'data:image/jpeg;base64,abc123');
});

test('transactions filter by type and search query', () => {
  const txs = [
    { id: 'MRD-1', counterparty: 'BlackRock', memo: 'Dividend', rail: 'Wire Transfer', type: 'deposit' },
    { id: 'MRD-2', counterparty: 'Apex Logistics', memo: 'Freight', rail: 'ACH Transfer', type: 'debit' },
  ];
  assert.equal(Core.filterTransactions(txs, 'all', '').length, 2);
  assert.equal(Core.filterTransactions(txs, 'deposit', '').length, 1);
  assert.equal(Core.filterTransactions(txs, 'debit', '').length, 1);
  assert.equal(Core.filterTransactions(txs, 'all', 'blackrock').length, 1);
  assert.equal(Core.filterTransactions(txs, 'debit', 'blackrock').length, 0);
});

test('account holder constant and derived login username', () => {
  assert.equal(Core.ACCOUNT_HOLDER, 'Timothy Townsend');
  assert.equal(Core.ACCOUNT_USERNAME, 'timothy.townsend');
  assert.equal(Core.ACCOUNT_LAST_NAME, 'Townsend');
});
