import assert from 'node:assert/strict';
import worker from '../worker.js';

const store = new Map();
const waits = [];
const ctx = { waitUntil: (promise) => waits.push(promise) };
const env = {
  SLACK_SIGNING_SECRET: 'slack-secret',
  SLACK_BOT_TOKEN: 'xoxb-test',
  HAIKPHEUS_STATE_TOKEN: 'state-secret',
  HAIKPHEUS_DB: fakeD1(store)
};
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  calls.push({ url, body: JSON.parse(options.body) });
  return Response.json({ ok: true, ts: '999.000' });
};

const challenge = await worker.fetch(new Request('https://haikpheus.test/', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'url_verification', challenge: 'abc123' })
}), env);
assert.equal(await challenge.text(), 'abc123');

await slashCommand({
  command: '/haik-in',
  channel_id: 'C123',
  user_id: 'U123'
});
await slashCommand({
  command: '/haik-chan-in',
  channel_id: 'C123',
  user_id: 'U123'
});
assert.equal(calls.at(-1).url, 'https://slack.com/api/conversations.join');
calls.length = 0;

const eventBody = JSON.stringify({
  type: 'event_callback',
  event: {
    type: 'message',
    channel: 'C123',
    user: 'U123',
    ts: '123.456',
    text: 'autumn rain falls down\ngentle rivers flowing slow\nnight birds sing softly'
  }
});
const eventPost = await worker.fetch(await signedRequest(eventBody, 'application/json'), env, ctx);

assert.equal(eventPost.status, 200);
assert.equal(calls.length, 3);
assert.equal(calls[0].url, 'https://slack.com/api/chat.postMessage');
assert.equal(calls[1].url, 'https://slack.com/api/reactions.add');
assert.equal(calls[2].url, 'https://slack.com/api/chat.postEphemeral');
await Promise.all(waits.splice(0));

calls.length = 0;
const thanksBody = JSON.stringify({
  type: 'event_callback',
  event: {
    type: 'message',
    channel: 'C123',
    user: 'U123',
    ts: '124.456',
    thread_ts: '123.456',
    text: 'thx haik'
  }
});
const thanksPost = await worker.fetch(await signedRequest(thanksBody, 'application/json'), env, ctx);

assert.equal(thanksPost.status, 200);
assert.equal(calls.length, 2);
assert.equal(calls[0].url, 'https://slack.com/api/reactions.add');
assert.deepEqual(calls[0].body, { channel: 'C123', timestamp: '124.456', name: 'heart' });
assert.equal(calls[1].url, 'https://slack.com/api/chat.postMessage');
assert.equal(calls[1].body.channel, 'C123');
assert.equal(calls[1].body.thread_ts, '123.456');
assert.match(calls[1].body.text, /---\nby <@U123>$/);
assert.deepEqual(calls[1].body.blocks[1], { type: 'divider' });
assert.notEqual(calls[1].body.text, 'your gratitude warms\nthis dinosaur heart so much\nalways here for you\n---\nby <@U123>');

calls.length = 0;
const looseThanksBody = JSON.stringify({
  type: 'event_callback',
  event: {
    type: 'message',
    channel: 'C123',
    user: 'U123',
    ts: '125.456',
    thread_ts: '123.456',
    text: 'thanks'
  }
});
const looseThanksPost = await worker.fetch(await signedRequest(looseThanksBody, 'application/json'), env, ctx);
assert.equal(looseThanksPost.status, 200);
assert.equal(calls.length, 0);

const get = await worker.fetch(new Request('https://haikpheus.test/state', {
  headers: { authorization: 'Bearer state-secret' }
}), env);

assert.deepEqual(await get.json(), { channels: ['C123'], users: ['U123'] });
globalThis.fetch = realFetch;
console.log('ok');

async function slashCommand(payload) {
  const body = new URLSearchParams(payload).toString();
  const response = await worker.fetch(await signedRequest(body, 'application/x-www-form-urlencoded'), env, ctx);
  assert.equal(response.status, 200);
  await Promise.all(waits.splice(0));
  return response;
}

async function signedRequest(body, contentType) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await sign(env.SLACK_SIGNING_SECRET, `v0:${timestamp}:${body}`);
  return new Request('https://haikpheus.test/slack', {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signature
    },
    body
  });
}

async function sign(secret, value) {
  const key = await crypto.subtle.importKey('raw', encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, encode(value));
  return `v0=${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function encode(value) {
  return new TextEncoder().encode(value);
}

function fakeD1(values) {
  return {
    prepare(sql) {
      return {
        params: [],
        bind(...params) {
          this.params = params;
          return this;
        },
        async run() {
          if (sql.startsWith('INSERT INTO haikpheus_state')) {
            const [key, value, expiresAt] = this.params;
            values.set(key, { value, expires_at: expiresAt ?? null });
          } else if (sql.startsWith('DELETE FROM haikpheus_state WHERE key = ?')) {
            values.delete(this.params[0]);
          } else if (sql.startsWith('DELETE FROM haikpheus_state WHERE expires_at')) {
            const now = this.params[0];
            for (const [key, row] of values.entries()) {
              if (row.expires_at && row.expires_at <= now) values.delete(key);
            }
          }
          return { success: true };
        },
        async first() {
          if (!sql.startsWith('SELECT value, expires_at FROM haikpheus_state')) return null;
          const row = values.get(this.params[0]);
          if (!row) return null;
          return { value: row.value, expires_at: row.expires_at };
        }
      };
    }
  };
}
