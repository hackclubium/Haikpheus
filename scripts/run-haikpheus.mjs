import { pathToFileURL } from 'node:url';
import { analyzeHaiku } from './haiku.mjs';

const haikuReaction = 'haiku';

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();

export async function main() {
  const token = mustEnv('SLACK_BOT_TOKEN');
  const state = await getState();

  for (const channel of state.channels) {
    const messages = await slack(token, 'conversations.history', { channel, limit: 50 }).catch((error) => {
      if (error.message.includes('not_in_channel') || error.message.includes('channel_not_found')) {
        console.warn(`Skipping ${channel}: ${error.message}`);
        return { messages: [] };
      }
      throw error;
    });

    for (const message of messages.messages ?? []) {
      if (!message.user || !state.users.includes(message.user) || message.subtype) continue;
      if ((message.text ?? '').length > 300) continue;
      const analysis = analyzeHaiku(message.text ?? '');
      if (!analysis.ok) continue;
      if ((message.reactions ?? []).some((reaction) => reaction.name === haikuReaction)) continue;
      const haiku = displayText(analysis.lines.join('\n'));

      await slack(token, 'chat.postMessage', {
        channel,
        thread_ts: message.ts,
        text: `${haiku}\n---\n– a haiku by <@${message.user}>, ${new Date().getUTCFullYear()}`,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: haiku } },
          { type: 'divider' },
          { type: 'context', elements: [{ type: 'mrkdwn', text: `– a haiku by <@${message.user}>, ${new Date().getUTCFullYear()}` }] }
        ],
        unfurl_links: false,
        unfurl_media: false
      });

      await slack(token, 'reactions.add', { channel, timestamp: message.ts, name: haikuReaction });
    }
  }
}

async function getState() {
  const url = new URL(mustEnv('HAIKPHEUS_STATE_URL'));
  if (url.pathname === '/') url.pathname = '/state';

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${mustEnv('HAIKPHEUS_STATE_TOKEN')}` }
  });
  if (!response.ok) throw new Error(`state fetch failed: ${response.status} ${url}`);
  return response.json();
}

async function slack(token, method, body) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  if (!json.ok) throw new Error(`${method}: ${json.error}`);
  return json;
}

function mustEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function displayText(text) {
  return text
    .replace(/<[a-z][a-z0-9+.-]*:\/\/[^>]*>/gi, ' ')
    .replace(/<[^>\s|]+\|[^>]*>/g, ' ')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/<[@#!][A-Z0-9][^>]*>/g, ' ')
    .replace(/<![^>]+>/g, ' ')
    .replace(/\b(?=[A-Z0-9]{8,}\b)(?=[A-Z0-9]*\d)[A-Z0-9]+\b/gi, ' ')
    .replace(/(^|\n)>\s?/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
