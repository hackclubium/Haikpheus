export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/__haikpheus/version') {
      return new Response('haikpheus-events-v2', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    if (request.method === 'GET' && url.pathname === '/state') return stateSnapshot(request, env);
    if (request.method !== 'POST') return new Response('not found', { status: 404 });

    const rawBody = await request.text();
    const verification = urlVerification(rawBody);
    if (verification) {
      return new Response(verification, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }

    const contentType = request.headers.get('content-type') ?? '';
    if (!(await validSlackRequest(request, rawBody, env.SLACK_SIGNING_SECRET))) {
      return new Response('invalid signature', { status: 401 });
    }

    if (contentType.includes('application/json')) return slackEvent(rawBody, env);

    const form = new URLSearchParams(rawBody);
    const command = form.get('command');
    if (!['/haik-in', '/haik-out', '/haik-chan-in', '/haik-chan-out'].includes(command)) {
      return slackResponse('Unknown command.');
    }

    await updateState(env, command, form.get('channel_id'), form.get('user_id'));

    return slackResponse(messageFor(command));
  }
};

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
  if (payload.type !== 'event_callback' || event?.type !== 'message') return new Response('ok');
  if (!event.user || event.subtype || event.bot_id || !event.channel || !event.ts) return new Response('ok');

  const state = await getState(env);
  if (!state.channels.includes(event.channel) || !state.users.includes(event.user)) return new Response('ok');
  if (!isHaiku(event.text ?? '')) return new Response('ok');

  await slack(env, 'chat.postMessage', {
    channel: event.channel,
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

function isHaiku(text) {
  const lines = text.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 3) return false;
  return [5, 7, 5].every((count, index) => syllables(lines[index]) === count);
}

function syllables(line) {
  const words = line.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
  return words.reduce((sum, word) => sum + syllablesInWord(word), 0);
}

function syllablesInWord(word) {
  const normalized = word.replace(/(?:e|ed|es)$/, '');
  const groups = normalized.match(/[aeiouy]+/g)?.length ?? 0;
  return Math.max(1, groups);
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
