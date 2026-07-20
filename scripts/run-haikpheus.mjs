import { pathToFileURL } from 'node:url';

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
      if (!isHaiku(message.text ?? '')) continue;
      if ((message.reactions ?? []).some((reaction) => reaction.name === haikuReaction)) continue;

      await slack(token, 'chat.postMessage', {
        channel,
        thread_ts: message.ts,
        text: `${message.text}\n---\nby <@${message.user}>`,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: message.text } },
          { type: 'divider' },
          { type: 'context', elements: [{ type: 'mrkdwn', text: `by <@${message.user}>` }] }
        ],
        unfurl_links: false,
        unfurl_media: false
      });

      await slack(token, 'reactions.add', { channel, timestamp: message.ts, name: haikuReaction });
    }
  }
}

export function isHaiku(text) {
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
