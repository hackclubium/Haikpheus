import assert from 'node:assert/strict';
import worker from '../worker.js';

const store = new Map();
const env = {
  SLACK_SIGNING_SECRET: 'slack-secret',
  HAIKPHEUS_STATE_TOKEN: 'state-secret',
  HAIKPHEUS_STATE: {
    async get(key, type) {
      const value = store.get(key);
      return type === 'json' && value ? JSON.parse(value) : value;
    },
    async put(key, value) {
      store.set(key, value);
    }
  }
};

const body = new URLSearchParams({
  command: '/haik-in',
  channel_id: 'C123',
  user_id: 'U123'
}).toString();

const timestamp = Math.floor(Date.now() / 1000).toString();
const signature = await sign(env.SLACK_SIGNING_SECRET, `v0:${timestamp}:${body}`);
const post = await worker.fetch(new Request('https://haikpheus.test/slack', {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    'x-slack-request-timestamp': timestamp,
    'x-slack-signature': signature
  },
  body
}), env);

assert.equal(post.status, 200);

const get = await worker.fetch(new Request('https://haikpheus.test/state', {
  headers: { authorization: 'Bearer state-secret' }
}), env);

assert.deepEqual(await get.json(), { channels: [], users: ['U123'] });
console.log('ok');

async function sign(secret, value) {
  const key = await crypto.subtle.importKey('raw', encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, encode(value));
  return `v0=${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function encode(value) {
  return new TextEncoder().encode(value);
}
