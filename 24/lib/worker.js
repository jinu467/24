/**
 * License Worker
 * - POST /validate
 *   Body: { code: string, deviceId: string }
 *   Checks if code exists and is unused. If unused, marks as used and stores deviceId.
 *   Response: { valid: boolean, error?: string }
 *
 * - POST /register  (admin only — for adding codes)
 *   Body: { code: string }
 *   Adds code to KV with status "unused".
 *
 * KV Schema (LICENSE_DB):
 *   Key: code (e.g. "ABC123")
 *   Value: JSON { status: "unused" | "used", deviceId: string, usedAt: string }
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    if (request.method === 'POST' && url.pathname === '/validate') {
      return handleValidate(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/register') {
      return handleRegister(request, env);
    }

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    // Optional: cleanup logic here if needed
  }
};

async function handleValidate(request, env) {
  try {
    const { code, deviceId } = await request.json();

    if (!code || !deviceId) {
      return json({ valid: false, error: 'code and deviceId are required' }, 400);
    }

    const raw = await env.LICENSE_DB.get(code);
    if (!raw) {
      return json({ valid: false, error: 'Invalid code' }, 200);
    }

    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      // Legacy plain-string value (e.g. "unused")
      record = { status: raw, deviceId: '', usedAt: '' };
    }

    if (record.status === 'unused') {
      // First-time use — mark as used
      await env.LICENSE_DB.put(code, JSON.stringify({
        status: 'used',
        deviceId: deviceId,
        usedAt: new Date().toISOString()
      }));
      return json({ valid: true, status: 'first_use' }, 200);
    }

    if (record.status === 'used') {
      if (record.deviceId === deviceId) {
        // Same device — allow without re-entry
        return json({ valid: true, status: 'already_registered' }, 200);
      }
      // Different device — reject
      return json({ valid: false, error: 'Code already used on another device' }, 200);
    }

    return json({ valid: false, error: 'Unknown error' }, 500);
  } catch (err) {
    return json({ valid: false, error: err.message }, 500);
  }
}

async function handleRegister(request, env) {
  try {
    // Simple admin key check (replace with your own secret)
    const authHeader = request.headers.get('Authorization');
    const adminKey = request.headers.get('X-Admin-Key');
    if (!adminKey || adminKey !== env.ADMIN_KEY) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const { code } = await request.json();
    if (!code) {
      return json({ error: 'code is required' }, 400);
    }

    const raw = await env.LICENSE_DB.get(code);
    if (raw) {
      try {
        JSON.parse(raw); // check if already a proper JSON object
        return json({ error: 'Code already exists' }, 409);
      } catch {
        // legacy plain-string value — treat as already exists
        return json({ error: 'Code already exists' }, 409);
      }
    }

    await env.LICENSE_DB.put(code, JSON.stringify({
      status: 'unused',
      deviceId: '',
      usedAt: ''
    }));

    return json({ success: true, code }, 200);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
