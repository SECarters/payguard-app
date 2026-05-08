/**
 * basiqCreateUser
 * Creates a Basiq user for the authenticated Base44 user.
 * Stores the Basiq user ID against their UserProfile.
 * Must be called once per user before they can link a bank account.
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

    // Check if user already has a Basiq user ID stored
    const profiles = await base44.entities.UserProfile.filter({ created_by: user.id });
    const profile = profiles?.[0];

    if (profile?.basiq_user_id) {
      return Response.json({
        ok: true,
        basiq_user_id: profile.basiq_user_id,
        already_existed: true,
        message: 'Basiq user already exists for this account',
      });
    }

    // Create Basiq user
    const token = await getBasiqToken();
    const basiqRes = await fetch(`${BASIQ_BASE_URL}/users`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'basiq-version': '3.0',
      },
      body: JSON.stringify({
        email: user.email,
        mobile: profile?.phone ?? undefined,
        firstName: profile?.full_name?.split(' ')[0] ?? undefined,
        lastName: profile?.full_name?.split(' ').slice(1).join(' ') ?? undefined,
      }),
    });

    const basiqUser = await basiqRes.json();
    if (!basiqUser.id) throw new Error(`Failed to create Basiq user: ${JSON.stringify(basiqUser)}`);

    // Store Basiq user ID in UserProfile (add basiq_user_id field)
    if (profile?.id) {
      await base44.entities.UserProfile.update(profile.id, {
        basiq_user_id: basiqUser.id,
      });
    }

    return Response.json({
      ok: true,
      basiq_user_id: basiqUser.id,
      already_existed: false,
      message: 'Basiq user created successfully',
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
