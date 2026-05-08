/**
 * basiqGetAccounts
 * Retrieves all bank accounts connected by the user via Basiq.
 * Returns account list with institution, BSB, account number, balance, account type.
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { basiq_user_id } = body;

    if (!basiq_user_id) {
      return Response.json({ error: 'basiq_user_id is required' }, { status: 400 });
    }

    const token = await getBasiqToken();

    // Fetch accounts
    const accountsRes = await fetch(`${BASIQ_BASE_URL}/users/${basiq_user_id}/accounts`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'basiq-version': '3.0',
      },
    });

    const accountsData = await accountsRes.json();
    const accounts = accountsData.data ?? [];

    // Normalise into clean structure
    const normalised = accounts.map((acc: any) => ({
      id: acc.id,
      institution: acc.institution ?? acc.institutionId ?? 'Unknown',
      account_no: acc.accountNo ?? null,
      bsb: acc.bsb ?? null,
      name: acc.name ?? null,
      type: acc.class?.type ?? acc.type ?? 'unknown',
      product: acc.class?.product ?? null,
      currency: acc.currency ?? 'AUD',
      balance: acc.balance ? parseFloat(acc.balance) : null,
      available_balance: acc.availableFunds ? parseFloat(acc.availableFunds) : null,
      last_updated: acc.lastUpdated ?? null,
      status: acc.status ?? 'active',
    }));

    return Response.json({
      ok: true,
      count: normalised.length,
      accounts: normalised,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
