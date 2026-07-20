const VERSION = 'haikpheus-events-v33';
const TRIGGER_RESPONSES = [
  {
    name: 'haiku_meta',
    pattern: /\b(haik|haiku|poetry|poem|bard|syllables?|chef'?s kiss|peak)\b/i,
    text: 'syllables bloom bright\nhaikpheus heard the small song\nthread gently glows'
  },
  {
    name: 'thanks',
    pattern: /\b(thank\s*you|thanks|tanx|thx|ty|appreciate\s+(it|you)|much appreciated|cheers|props|kudos|bless)\b/i,
    text: 'your gratitude warms\nthis dinosaur heart so much\nalways here for you'
  },
  {
    name: 'praise',
    pattern: /\b(beautiful|nice haiku|good bot|well done|love this|you rock|great job|nailed it)\b/i,
    text: 'small words found their wings\nseventeen steps in moonlight\nand now we all glow'
  },
  {
    name: 'surprise',
    pattern: /\b(wow|whoa|woah|omg|no way|wait (that'?s|thats) a haiku|how did you catch that)\b/i,
    text: 'surprise in the thread\nhidden poems wake and wave\ncaught between the lines'
  },
  {
    name: 'affection',
    pattern: /\b(ily|love you|luv u|you'?re the best|ur the best)\b/i,
    text: 'tiny robot heart\nkeeps a warm place in the thread\nfor your gentle words'
  }
];
let haikuModule;
let dbReady;
const ENABLED_FLAVORS = [
  'haiku enabled!',
  'your syllables shall now be counted',
  'poetic justice incoming',
  'your inner poet is now free',
  'haiku powers: unlocked',
  'time to channel your inner poet'
];
const DISABLED_FLAVORS = [
  'okay, no more haiku for you',
  'got it, not a poetry person',
  "i'll spare you from my poetic wrath",
  'your loss, but i respect your choice',
  "fine, but i'll still be counting syllables in my head",
  'understood, but my inner poet is crying',
  'okay, but my muse is giving you the side-eye'
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/__haikpheus/version') {
      return new Response(VERSION, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    if (request.method === 'GET' && url.pathname === '/__haikpheus/health') return health(env);
    if (request.method === 'GET' && url.pathname === '/__haikpheus/debug') return debugState(env);
    if (request.method === 'GET' && url.pathname === '/__haikpheus/slack-debug') return slackDebug(env);
    if (request.method === 'GET' && url.pathname === '/__haikpheus/analyze') return analyzeRequest(url);
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

    if (contentType.includes('application/json')) {
      try {
        return await slackEvent(rawBody, env);
      } catch (error) {
        await recordDiagnostic(env, { type: 'event_error', error: error.message, at: new Date().toISOString() });
        return new Response('ok');
      }
    }

    return slashCommand(rawBody, env, ctx);
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
    hasD1Binding: Boolean(env.HAIKPHEUS_DB),
    d1Readable: false
  };

  try {
    await getState(env);
    checks.d1Readable = true;
  } catch (error) {
    checks.d1Error = error.message;
  }

  return Response.json(checks);
}

async function debugState(env) {
  const state = await getState(env);
  const diagnostic = (await dbGet(env, 'lastDiagnostic', 'json')) ?? null;
  const messageDiagnostic = (await dbGet(env, 'lastMessageDiagnostic', 'json')) ?? null;
  const slashDiagnostic = (await dbGet(env, 'lastSlashDiagnostic', 'json')) ?? null;
  const recentMessages = (await dbGet(env, 'recentMessageDiagnostics', 'json')) ?? [];
  return Response.json({ version: VERSION, state, diagnostic, messageDiagnostic, slashDiagnostic, recentMessages });
}

async function slackDebug(env) {
  const state = await getState(env);
  const channels = [];

  for (const channel of state.channels) {
    const info = await slack(env, 'conversations.info', { channel }).catch((error) => ({ error: error.message }));
    channels.push({
      id: channel,
      ok: Boolean(info.channel),
      name: info.channel?.name,
      isChannel: info.channel?.is_channel,
      isGroup: info.channel?.is_group,
      isMember: info.channel?.is_member,
      error: info.error
    });
  }

  return Response.json({ version: VERSION, channels });
}

function analyzeRequest(url) {
  return loadHaiku().then(({ analyzeHaiku }) => Response.json(analyzeHaiku(url.searchParams.get('text') ?? '')));
}

async function slashCommand(rawBody, env, ctx) {
  const form = new URLSearchParams(rawBody);
  const command = form.get('command');
  if (!['/haik-in', '/haik-out', '/haik-chan-in', '/haik-chan-out', '/haik-test', '/haik-debug', '/enable-haiku', '/disable-haiku'].includes(command)) {
    return slackResponse('Unknown command.');
  }

  if (command === '/haik-test') {
    const { analyzeHaiku } = await loadHaiku();
    return slackResponse(`\`\`\`json\n${JSON.stringify(analyzeHaiku(form.get('text') ?? ''), null, 2)}\n\`\`\``);
  }
  if (command === '/haik-debug') return slackResponse(`\`\`\`json\n${JSON.stringify(await slashDebug(env, form), null, 2)}\n\`\`\``);

  const payload = { command, channel: form.get('channel_id'), user: form.get('user_id') };
  try {
    await updateState(env, payload.command, payload.channel, payload.user);
    await recordSlashDiagnostic(env, { ...payload, type: 'slash_ok', at: new Date().toISOString() });
    if (payload.command === '/haik-chan-in') waitUntil(ctx, joinChannelInBackground(env, payload));
  } catch (error) {
    await recordSlashDiagnostic(env, { ...payload, type: 'slash_error', error: error.message, at: new Date().toISOString() });
    return slackResponse(`Haikpheus config error: ${error.message}`);
  }

  const joinNote = command === '/haik-chan-in' ? ' Public channels auto-join in background; private channels still need `/invite @Haikpheus`.' : '';
  return slackResponse(`${messageFor(command)}${joinNote} (${VERSION}; saving in background; you=${payload.user}; channel=${payload.channel})`);
}

async function slashDebug(env, form) {
  const state = await getState(env);
  return {
    version: VERSION,
    slashUser: form.get('user_id'),
    slashChannel: form.get('channel_id'),
    userOptedIn: state.users.includes(form.get('user_id')),
    channelOptedIn: state.channels.includes(form.get('channel_id')),
    state,
    lastMessage: (await dbGet(env, 'lastMessageDiagnostic', 'json')) ?? null,
    recentMessages: (await dbGet(env, 'recentMessageDiagnostics', 'json')) ?? []
  };
}

async function joinChannelInBackground(env, payload) {
  try {
    const joinNote = await joinChannel(env, payload.channel);
    await recordDiagnostic(env, { ...payload, type: 'join_ok', joinNote, at: new Date().toISOString() });
  } catch (error) {
    await recordDiagnostic(env, { ...payload, type: 'join_error', error: error.message, at: new Date().toISOString() });
  }
}

async function lastDiagnostic(request, env) {
  if (request.headers.get('authorization') !== `Bearer ${env.HAIKPHEUS_STATE_TOKEN}`) {
    return new Response('unauthorized', { status: 401 });
  }
  return Response.json((await dbGet(env, 'lastDiagnostic', 'json')) ?? null);
}

async function recordDiagnostic(env, value) {
  await dbPut(env, 'lastDiagnostic', JSON.stringify(value)).catch(() => {});
}

async function recordMessageDiagnostic(env, value) {
  try {
    await dbPut(env, 'lastMessageDiagnostic', JSON.stringify(value));
    const recent = (await dbGet(env, 'recentMessageDiagnostics', 'json')) ?? [];
    recent.unshift(value);
    await dbPut(env, 'recentMessageDiagnostics', JSON.stringify(recent.slice(0, 20)));
  } catch {}
  await recordDiagnostic(env, value);
}

async function recordSlashDiagnostic(env, value) {
  await dbPut(env, 'lastSlashDiagnostic', JSON.stringify(value)).catch(() => {});
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
    at: new Date().toISOString()
  });
  if (payload.type !== 'event_callback' || event?.type !== 'message') return new Response('ok');
  if (!event.user || event.subtype || event.bot_id || !event.channel || !event.ts) {
    await recordDiagnostic(env, { type: 'message_skip', reason: 'not_user_message', at: new Date().toISOString() });
    return new Response('ok');
  }

  if (await handleThankYou(env, event)) return new Response('ok');

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
  if ((event.text ?? '').length > 300) {
    await recordMessageDiagnostic(env, { type: 'message_skip', reason: 'too_long', channel: event.channel, user: event.user, at: new Date().toISOString() });
    return new Response('ok');
  }

  const result = await processHaikuMessage(env, {
    channel: event.channel,
    user: event.user,
    ts: event.ts,
    text: event.text ?? '',
    thread_ts: event.thread_ts,
    reactions: []
  });
  if (!result.ok) {
    await recordMessageDiagnostic(env, {
      type: 'message_skip',
      reason: result.reason,
      channel: event.channel,
      user: event.user,
      text: event.text ?? '',
      counts: result.analysis?.counts ?? [],
      lines: result.analysis?.lines ?? [],
      at: new Date().toISOString()
    });
    return new Response('ok');
  }
  await recordMessageDiagnostic(env, {
    type: 'haiku_posted',
    channel: event.channel,
    user: event.user,
    source: 'event',
    lines: result.analysis.lines,
    counts: result.analysis.counts,
    at: new Date().toISOString()
  });

  return new Response('ok');
}

async function processHaikuMessage(env, message) {
  const { analyzeHaiku } = await loadHaiku();
  const processedKey = `processed:${message.channel}:${message.ts}`;
  if (await dbGet(env, processedKey)) return { ok: false, reason: 'already_seen' };
  if ((message.reactions ?? []).some((reaction) => reaction.name === 'haiku')) return { ok: false, reason: 'already_seen' };

  const analysis = analyzeHaiku(message.text);
  if (!analysis.ok) return { ok: false, reason: 'not_haiku', analysis };

  const haiku = analysis.lines.join('\n');
  await Promise.all([
    slack(env, 'chat.postMessage', {
      channel: message.channel,
      thread_ts: message.ts,
      text: `${haiku}\n---\n– a haiku by <@${message.user}>, ${new Date().getUTCFullYear()}`,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: haiku } },
        { type: 'divider' },
        { type: 'context', elements: [{ type: 'mrkdwn', text: `– a haiku by <@${message.user}>, ${new Date().getUTCFullYear()}` }] }
      ],
      unfurl_links: false,
      unfurl_media: false
    }),
    slack(env, 'reactions.add', { channel: message.channel, timestamp: message.ts, name: 'haiku' })
  ]);
  await markHaikued(env, message.thread_ts || message.ts).catch(() => {});
  await dbPut(env, processedKey, '1', 12 * 60 * 60).catch(() => {});
  await sendOptOutHint(env, message.channel, message.user, message.thread_ts || message.ts).catch((error) => (
    recordDiagnostic(env, { type: 'hint_error', error: error.message, at: new Date().toISOString() })
  ));
  return { ok: true, analysis };
}

function loadHaiku() {
  haikuModule ||= import('./scripts/haiku.mjs');
  return haikuModule;
}

async function handleThankYou(env, event) {
  const trigger = thankYouTrigger(event.text ?? '');
  if (!event.thread_ts || !trigger) return false;
  if (!(await wasHaikued(env, event.thread_ts))) return false;

  // reactions.add failing (e.g. already_reacted on a Slack retry) shouldn't block the reply
  await slack(env, 'reactions.add', { channel: event.channel, timestamp: event.ts, name: 'heart' }).catch(() => {});
  await slack(env, 'chat.postMessage', {
    channel: event.channel,
    thread_ts: event.thread_ts,
    text: `${trigger.text}\n---\nby <@${event.user}>`
  });
  await dbDelete(env, `haikued:${event.thread_ts}`).catch(() => {});
  await recordMessageDiagnostic(env, { type: 'thank_you', trigger: trigger.name, channel: event.channel, user: event.user, at: new Date().toISOString() });
  return true;
}

function thankYouTrigger(text) {
  return TRIGGER_RESPONSES.find((trigger) => trigger.pattern.test(text));
}

async function markHaikued(env, threadTs) {
  await dbPut(env, `haikued:${threadTs}`, '1', 12 * 60 * 60);
}

async function wasHaikued(env, threadTs) {
  return Boolean(await dbGet(env, `haikued:${threadTs}`));
}

async function sendOptOutHint(env, channel, user, threadTs) {
  const key = `haiku_hinted:${user}`;
  if (await dbGet(env, key)) return;

  await slack(env, 'chat.postEphemeral', {
    channel,
    user,
    thread_ts: threadTs,
    text: "you don't want me to\nnotice and speak your poems?\n`/haik-out`"
  });
  await dbPut(env, key, '1');
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
    '/haik-in': `${sample(ENABLED_FLAVORS)} – you can disable it with \`/haik-out\``,
    '/enable-haiku': `${sample(ENABLED_FLAVORS)} – you can disable it with \`/haik-out\``,
    '/haik-out': `${sample(DISABLED_FLAVORS)} – you can reënable it with \`/haik-in\``,
    '/disable-haiku': `${sample(DISABLED_FLAVORS)} – you can reënable it with \`/haik-in\``,
    '/haik-chan-in': 'Haiku tracking on for this channel.',
    '/haik-chan-out': 'Haiku tracking off for this channel.'
  }[command];
}

function sample(items) {
  return items[Math.floor(Math.random() * items.length)];
}

async function updateState(env, command, channel, user) {
  const state = await getState(env);
  switch (command) {
    case '/haik-in':
    case '/enable-haiku':
      add(state.users, user);
      break;
    case '/haik-out':
    case '/disable-haiku':
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
  await dbPut(env, 'state', JSON.stringify(state));
}

async function getState(env) {
  return (await dbGet(env, 'state', 'json')) ?? { channels: [], users: [] };
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

async function dbGet(env, key, type = 'text') {
  await ensureDb(env);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.HAIKPHEUS_DB
    .prepare('SELECT value, expires_at FROM haikpheus_state WHERE key = ?')
    .bind(key)
    .first();
  if (!row) return null;
  if (row.expires_at && row.expires_at <= now) {
    await dbDelete(env, key);
    return null;
  }
  return type === 'json' ? JSON.parse(row.value) : row.value;
}

async function dbPut(env, key, value, expirationTtl = null) {
  await ensureDb(env);
  const expiresAt = expirationTtl ? Math.floor(Date.now() / 1000) + expirationTtl : null;
  await env.HAIKPHEUS_DB
    .prepare('INSERT INTO haikpheus_state (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at')
    .bind(key, value, expiresAt)
    .run();
}

async function dbDelete(env, key) {
  await ensureDb(env);
  await env.HAIKPHEUS_DB
    .prepare('DELETE FROM haikpheus_state WHERE key = ?')
    .bind(key)
    .run();
}

async function ensureDb(env) {
  if (!env.HAIKPHEUS_DB) throw new Error('HAIKPHEUS_DB D1 binding is required');
  dbReady ||= env.HAIKPHEUS_DB
    .prepare('CREATE TABLE IF NOT EXISTS haikpheus_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)')
    .run()
    .then(async () => {
      await env.HAIKPHEUS_DB
        .prepare('DELETE FROM haikpheus_state WHERE expires_at IS NOT NULL AND expires_at <= ?')
        .bind(Math.floor(Date.now() / 1000))
        .run();
    });
  await dbReady;
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
