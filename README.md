# Haikpheus
Orpheus who likes haikus :)

Slack bot that watches opted-in channels for opted-in users. When a message looks like a 5/7/5 haiku, it reposts:

```text
original haiku
---
by <@USERID>
```

Then it reacts with `:haiku:`.

## Shape

- GitHub Actions runs `scripts/run-haikpheus.mjs` on every push and every 6 hours.
- Cloudflare Worker receives Slack slash commands.
- Cloudflare KV stores opted-in Slack channel IDs and user IDs.
- GitHub Actions fetches a signed state snapshot from the Worker before each run.

## Slack App

Create a Slack app with these bot scopes:

- `channels:history`
- `channels:read`
- `chat:write`
- `reactions:write`

For private channels, also add:

- `groups:history`
- `groups:read`

Add these slash commands, all pointing at the Worker URL:

- `/haik-in`
- `/haik-out`
- `/haik-chan-in`
- `/haik-chan-out`

Invite the bot to any channel it should watch.

## GitHub Secrets

Set repository secret:

- `SLACK_BOT_TOKEN`: Slack bot token, starts with `xoxb-`.
- `HAIKPHEUS_STATE_URL`: Worker state endpoint, for example `https://haikpheus.example.workers.dev/state`.
- `HAIKPHEUS_STATE_TOKEN`: shared secret used by GitHub Actions to read Worker state.

## Worker Secrets

Deploy `worker.js` to Cloudflare Workers with these secrets/vars:

- `SLACK_SIGNING_SECRET`: Slack app signing secret.
- `HAIKPHEUS_STATE_TOKEN`: same value as the GitHub secret.

Bind a KV namespace named `HAIKPHEUS_STATE`. Update `wrangler.toml` with its namespace ID.

## Commands

- `/haik-in`: opt yourself in.
- `/haik-out`: opt yourself out.
- `/haik-chan-in`: opt current channel in.
- `/haik-chan-out`: opt current channel out.

Users are off by default. Channels are off until `/haik-chan-in` runs.

## Local Checks

```sh
node --check scripts/run-haikpheus.mjs
node --check worker.js
node scripts/self-check.mjs
node scripts/worker-self-check.mjs
```

## Limits

Haiku detection uses a small English vowel-group heuristic. It will miss edge cases. Replace `syllablesInWord` with a dictionary later if accuracy matters.
