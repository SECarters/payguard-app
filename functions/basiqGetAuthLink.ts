/**
 * basiqGetAuthLink
 * Generates a Basiq consent UI link for the user to connect their bank account.
 * The user visits this URL in their browser to authorise their bank.
 * 
 * Body params:
 *   basiq_user_id  (required)
 *   mobile         (optional) — e.g. "+61412345678". Required by Basiq if not already set on user.
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
    const { basiq_user_id, mobile } = body;

    if (!basiq_user_id) {
      return Response.json({ error: 'basiq_user_id is required' }, { status: 400 });
    }

    // Get mobile from UserProfile if not passed in
    let mobileNumber = mobile;
    if (!mobileNumber) {
      const profiles = await base44.entities.UserProfile.filter({ created_by: user.id });
      mobileNumber = profiles?.[0]?.phone ?? null;
    }

    if (!mobileNumber) {
      return Response.json({
        error: 'A mobile number is required to generate a bank connection link. Please add your mobile number to your profile first.',
        code: 'mobile_required',
      }, { status: 400 });
    }

    const token = await getBasiqToken();

    // Create auth link (Basiq consent UI)
    const linkRes = await fetch(`${BASIQ_BASE_URL}/users/${basiq_user_id}/auth_link`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'basiq-version': '3.0',
      },
      body: JSON.stringify({ mobile: mobileNumber }),
    });

    const linkData = await linkRes.json();

    if (!linkData.links?.public) {
      throw new Error(`Failed to create auth link: ${JSON.stringify(linkData)}`);
    }

    return Response.json({
      ok: true,
      auth_link: linkData.links.public,
      expires: linkData.expiresAt ?? null,
      message: 'Bank connection link ready. Direct the user to this URL to securely connect their bank account.',
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
