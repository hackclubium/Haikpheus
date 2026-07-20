import { analyzeHaiku, isHaiku, syllableCounts } from './scripts/haiku.mjs';

const VERSION = 'haikpheus-events-v14';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/__haikpheus/version') {
      return new Response(VERSION, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    if (request.method === 'GET' && url.pathname === '/__haikpheus/health') return health(env);
    if (request.method === 'GET' && url.pathname === '/__haikpheus/debug') return debugState(env);
    if (request.method === 'GET' && url.pathname === '/__haikpheus/last') return lastDiagnostic(request, env);
    if (request.method === 'GET' && url.pathname === '/state') return stateSnapshot(request, env);
    if (request.method !== 'POST') return new Response('not found', { status: 404 });

    const rawBody = await request.text();
    waitUntil(ctx, recordDiagnostic(env, {
      type: 'post_seen',
      at: new Date().toISOString(),
      path: url.pathname,
      contentType: request.headers.get('content-type') ?? '',
      bodyStart: rawBody.slice(0, 80)
    }));

    const verification = urlVerification(rawBody);
    if (verification) {
      return new Response(verification, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }

    const contentType = request.headers.get('content-type') ?? '';
    if (!(await validSlackRequest(request, rawBody, env.SLACK_SIGNING_SECRET))) {
      waitUntil(ctx, recordDiagnostic(env, { type: 'invalid_signature', at: new Date().toISOString() }));
      return slackResponse('Haikpheus received this command, but Slack signature verification failed. Check Worker SLACK_SIGNING_SECRET.');
    }

    if (contentType.includes('application/json')) return slackEvent(rawBody, env);

    const form = new URLSearchParams(rawBody);
    const command = form.get('command');
    if (!['/haik-in', '/haik-out', '/haik-chan-in', '/haik-chan-out'].includes(command)) {
      return slackResponse('Unknown command.');
    }

    const payload = { command, channel: form.get('channel_id'), user: form.get('user_id') };
    let joinNote = '';
    try {
      if (payload.command === '/haik-chan-in') joinNote = await joinChannel(env, payload.channel);
      await updateState(env, payload.command, payload.channel, payload.user);
      await recordSlashDiagnostic(env, { ...payload, type: 'slash_ok', at: new Date().toISOString() });
    } catch (error) {
      await recordSlashDiagnostic(env, { ...payload, type: 'slash_error', error: error.message, at: new Date().toISOString() });
      return slackResponse(`Haikpheus config error: ${error.message}`);
    }

    const state = await getState(env);
    return slackResponse(`${messageFor(command)}${joinNote} (${VERSION}; you=${payload.user}; channel=${payload.channel}; channels=${state.channels.join(',') || 'none'}; users=${state.users.join(',') || 'none'})`);
  }
};

function waitUntil(ctx, promise) {
  if (ctx?.waitUntil) ctx.waitUntil(promise);
  else promise.catch(() => {});
}

async function health(env) {
  const checks = {
    version: VERSION,
    hasSlackSigningSecret: Boolean(env.SLACK_SIGNING_SECRET),
    hasSlackBotToken: Boolean(env.SLACK_BOT_TOKEN),
    hasStateToken: Boolean(env.HAIKPHEUS_STATE_TOKEN),
    hasKvBinding: Boolean(env.HAIKPHEUS_STATE),
    kvReadable: false
  };

  try {
    await getState(env);
    checks.kvReadable = true;
  } catch (error) {
    checks.kvError = error.message;
  }

  return Response.json(checks);
}

async function debugState(env) {
  const state = await getState(env);
  const diagnostic = (await env.HAIKPHEUS_STATE.get('lastDiagnostic', 'json')) ?? null;
  const messageDiagnostic = (await env.HAIKPHEUS_STATE.get('lastMessageDiagnostic', 'json')) ?? null;
  const slashDiagnostic = (await env.HAIKPHEUS_STATE.get('lastSlashDiagnostic', 'json')) ?? null;
  return Response.json({ version: VERSION, state, diagnostic, messageDiagnostic, slashDiagnostic });
}

async function lastDiagnostic(request, env) {
  if (request.headers.get('authorization') !== `Bearer ${env.HAIKPHEUS_STATE_TOKEN}`) {
    return new Response('unauthorized', { status: 401 });
  }
  return Response.json((await env.HAIKPHEUS_STATE.get('lastDiagnostic', 'json')) ?? null);
}

async function recordDiagnostic(env, value) {
  await env.HAIKPHEUS_STATE.put('lastDiagnostic', JSON.stringify(value));
}

async function recordMessageDiagnostic(env, value) {
  await env.HAIKPHEUS_STATE.put('lastMessageDiagnostic', JSON.stringify(value));
  await recordDiagnostic(env, value);
}

async function recordSlashDiagnostic(env, value) {
  await env.HAIKPHEUS_STATE.put('lastSlashDiagnostic', JSON.stringify(value));
  await recordDiagnostic(env, value);
}

function urlVerification(rawBody) {
  try {
    const payload = JSON.parse(rawBody);
    return payload?.type === 'url_verification' ? payload.challenge : '';
  } catch {
    return '';
  }
}

async function slackEvent(rawBody, env) {
  const payload = JSON.parse(rawBody);
  if (payload.type === 'url_verification') return Response.json({ challenge: payload.challenge });

  const event = payload.event;
  await recordDiagnostic(env, {
    type: 'event_seen',
    payloadType: payload.type,
    eventType: event?.type,
    channel: event?.channel,
    user: event?.user,
    text: event?.text ?? '',
    counts: syllableCounts(event?.text ?? ''),
    at: new Date().toISOString()
  });
  if (payload.type !== 'event_callback' || event?.type !== 'message') return new Response('ok');
  if (!event.user || event.subtype || event.bot_id || !event.channel || !event.ts) {
    await recordDiagnostic(env, { type: 'message_skip', reason: 'not_user_message', at: new Date().toISOString() });
    return new Response('ok');
  }

  const state = await getState(env);
  if (!state.channels.includes(event.channel) || !state.users.includes(event.user)) {
    await recordMessageDiagnostic(env, {
      type: 'message_skip',
      reason: 'not_opted_in',
      channel: event.channel,
      user: event.user,
      state,
      at: new Date().toISOString()
    });
    return new Response('ok');
  }
  if (!isHaiku(event.text ?? '')) {
    const analysis = analyzeHaiku(event.text ?? '');
    await recordMessageDiagnostic(env, {
      type: 'message_skip',
      reason: 'not_haiku',
      channel: event.channel,
      user: event.user,
      text: event.text ?? '',
      counts: analysis.counts,
      lines: analysis.lines,
      at: new Date().toISOString()
    });
    return new Response('ok');
  }

  await slack(env, 'chat.postMessage', {
    channel: event.channel,
    thread_ts: event.ts,
    text: `${event.text}\n---\nby <@${event.user}>`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: event.text } },
      { type: 'divider' },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `by <@${event.user}>` }] }
    ],
    unfurl_links: false,
    unfurl_media: false
  });
  await slack(env, 'reactions.add', { channel: event.channel, timestamp: event.ts, name: 'haiku' });
  await recordMessageDiagnostic(env, { type: 'haiku_posted', channel: event.channel, user: event.user, at: new Date().toISOString() });

  return new Response('ok');
}

async function stateSnapshot(request, env) {
  if (request.headers.get('authorization') !== `Bearer ${env.HAIKPHEUS_STATE_TOKEN}`) {
    return new Response('unauthorized', { status: 401 });
  }
  return Response.json(await getState(env));
}

function slackResponse(text) {
  return Response.json({ response_type: 'ephemeral', text });
}

function messageFor(command) {
  return {
    '/haik-in': 'Haiku tracking on for you.',
    '/haik-out': 'Haiku tracking off for you.',
    '/haik-chan-in': 'Haiku tracking on for this channel.',
    '/haik-chan-out': 'Haiku tracking off for this channel.'
  }[command];
}

async function updateState(env, command, channel, user) {
  const state = await getState(env);
  switch (command) {
    case '/haik-in':
      add(state.users, user);
      break;
    case '/haik-out':
      remove(state.users, user);
      break;
    case '/haik-chan-in':
      add(state.channels, channel);
      break;
    case '/haik-chan-out':
      remove(state.channels, channel);
      break;
  }
  state.channels.sort();
  state.users.sort();
  await env.HAIKPHEUS_STATE.put('state', JSON.stringify(state));
}

async function getState(env) {
  return (await env.HAIKPHEUS_STATE.get('state', 'json')) ?? { channels: [], users: [] };
}

async function slack(env, method, body) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      'content-type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  if (!json.ok) throw new Error(`${method}: ${json.error}`);
  return json;
}

async function joinChannel(env, channel) {
  try {
    await slack(env, 'conversations.join', { channel });
    return '';
  } catch (error) {
    if (error.message.includes('method_not_supported_for_channel_type')) return ' Private channel: invite me manually with `/invite @Haikpheus`.';
    if (error.message.includes('is_archived')) throw error;
    if (error.message.includes('channel_not_found')) throw error;
    throw error;
  }
}

function add(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function remove(list, value) {
  const index = list.indexOf(value);
  if (index !== -1) list.splice(index, 1);
}

async function validSlackRequest(request, rawBody, secret) {
  const timestamp = request.headers.get('x-slack-request-timestamp');
  const signature = request.headers.get('x-slack-signature');
  if (!timestamp || !signature || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const key = await crypto.subtle.importKey('raw', encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, encode(`v0:${timestamp}:${rawBody}`));
  return timingSafeEqual(signature, `v0=${hex(digest)}`);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function encode(value) {
  return new TextEncoder().encode(value);
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
