/**
 * basiqGetTransactions
 * Retrieves transactions for a user's connected bank accounts.
 * Filters and categorises payroll-relevant transactions:
 *   - Salary/wage deposits
 *   - Superannuation payments (from employer)
 * Returns enriched transaction list ready for payroll audit cross-referencing.
 * 
 * Body params:
 *   basiq_user_id   (required) — Basiq user ID
 *   account_id      (optional) — filter to specific account
 *   from_date       (optional) — ISO date string e.g. "2025-07-01"
 *   to_date         (optional) — ISO date string e.g. "2026-06-30"
 *   payroll_only    (optional, bool) — if true, only return salary/payroll transactions
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const BASIQ_API_KEY = Deno.env.get('BASIQ_API_KEY') ?? '';
const BASIQ_BASE_URL = 'https://au-api.basiq.io';

async function getBasiqToken(): Promise<string> {
  const res = await fetch(`${BASIQ_BASE_URL}/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${BASIQ_API_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'basiq-version': '3.0',
    },
    body: 'scope=SERVER_ACCESS',
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Basiq auth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// Keywords that indicate payroll/salary deposits
const PAYROLL_KEYWORDS = [
  'salary', 'wages', 'payroll', 'pay', 'remuneration',
  'eft credit', 'direct credit', 'employer', 'superannuation',
  'super', 'sgc', 'compulsory super',
];

// Keywords that indicate super contributions (from employer)
const SUPER_KEYWORDS = [
  'superannuation', 'super', 'sgc', 'rest', 'hostplus', 'australiansuper',
  'sunsuper', 'hesta', 'cbus', 'aware super', 'uni super', 'vision super',
  'media super', 'prime super', 'legalsuper', 'tasplan', 'care super',
  'stateplus', 'mtaa', 'twusuper', 'guild', 'childcare super',
];

function classifyTransaction(tx: any): string {
  const desc = (tx.description ?? '').toLowerCase();
  const subCat = (tx.subClass?.title ?? '').toLowerCase();
  const cat = (tx.class?.title ?? '').toLowerCase();

  if (SUPER_KEYWORDS.some(k => desc.includes(k)) && tx.direction === 'credit') {
    return 'superannuation';
  }
  if (
    PAYROLL_KEYWORDS.some(k => desc.includes(k)) ||
    subCat.includes('salary') ||
    subCat.includes('payroll') ||
    cat.includes('income')
  ) {
    if (tx.direction === 'credit') return 'salary_deposit';
  }
  if (tx.direction === 'credit') return 'credit';
  return 'debit';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const {
      basiq_user_id,
      account_id,
      from_date,
      to_date,
      payroll_only = false,
    } = body;

    if (!basiq_user_id) {
      return Response.json({ error: 'basiq_user_id is required' }, { status: 400 });
    }

    const token = await getBasiqToken();

    // Build query params
    const params = new URLSearchParams();
    if (from_date) params.set('filter[transaction.postDate]', `gt:${from_date},lt:${to_date ?? new Date().toISOString().split('T')[0]}`);
    if (account_id) params.set('filter[account.id]', account_id);
    params.set('limit', '500');

    const url = `${BASIQ_BASE_URL}/users/${basiq_user_id}/transactions?${params.toString()}`;

    const txRes = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'basiq-version': '3.0',
      },
    });

    const txData = await txRes.json();
    const transactions = txData.data ?? [];

    // Normalise and classify
    const normalised = transactions.map((tx: any) => {
      const classification = classifyTransaction(tx);
      return {
        id: tx.id,
        account_id: tx.account,
        institution: tx.institution ?? null,
        date: tx.transactionDate ?? tx.postDate ?? null,
        post_date: tx.postDate ?? null,
        amount: tx.amount ? parseFloat(tx.amount) : null,
        direction: tx.direction ?? null, // 'credit' | 'debit'
        description: tx.description ?? null,
        category: tx.class?.title ?? null,
        sub_category: tx.subClass?.title ?? null,
        classification, // 'salary_deposit' | 'superannuation' | 'credit' | 'debit'
        is_payroll_relevant: ['salary_deposit', 'superannuation'].includes(classification),
        balance: tx.balance ? parseFloat(tx.balance) : null,
        status: tx.status ?? 'posted',
        enrich: {
          merchant: tx.enrich?.merchant?.businessName ?? null,
          category_label: tx.enrich?.category?.anzsic?.subDivision?.title ?? null,
        },
      };
    });

    // Filter if payroll_only requested
    const result = payroll_only
      ? normalised.filter((t: any) => t.is_payroll_relevant)
      : normalised;

    // Summary stats for payroll audit
    const salaryDeposits = result.filter((t: any) => t.classification === 'salary_deposit');
    const superPayments = result.filter((t: any) => t.classification === 'superannuation');
    const totalSalaryReceived = salaryDeposits.reduce((sum: number, t: any) => sum + (t.amount ?? 0), 0);
    const totalSuperReceived = superPayments.reduce((sum: number, t: any) => sum + (t.amount ?? 0), 0);

    return Response.json({
      ok: true,
      total_transactions: normalised.length,
      payroll_relevant_count: result.filter((t: any) => t.is_payroll_relevant).length,
      summary: {
        salary_deposits: salaryDeposits.length,
        total_salary_received: Math.round(totalSalaryReceived * 100) / 100,
        super_payments: superPayments.length,
        total_super_received: Math.round(totalSuperReceived * 100) / 100,
        date_range: {
          from: from_date ?? 'all',
          to: to_date ?? 'all',
        },
      },
      transactions: result,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
