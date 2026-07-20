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

- GitHub Actions runs local checks on every push.
- GitHub Actions runs `scripts/run-haikpheus.mjs` every 6 hours and on manual dispatch as a backstop.
- Cloudflare Worker receives Slack slash commands.
- Cloudflare Worker receives Slack message events and posts matching haikus immediately.
- Cloudflare KV stores opted-in Slack channel IDs and user IDs.
- GitHub Actions still runs as a periodic/manual backstop.

## Slack App

Create a Slack app with these bot scopes:

- `channels:history`
- `channels:join`
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
- `/haik-test` to show detector output for text, for example `/haik-test :101777: gentle rivers flowing slow night birds sing softly`
- `/haik-debug` to show current Slack user/channel IDs, opt-in state, and latest received message event
- `/enable-haiku` optional Orpheus-compatible alias for `/haik-in`
- `/disable-haiku` optional Orpheus-compatible alias for `/haik-out`

`/haik-chan-in` tries to join public channels automatically. Private channels still need:

```text
/invite @Haikpheus
```

Enable Events API:

- Request URL: Worker URL, for example `https://haikpheus.example.workers.dev`
- Subscribe to bot event: `message.channels`
- For private channels, also subscribe to: `message.groups`

## GitHub Secrets

Set repository secret:

- `SLACK_BOT_TOKEN`: Slack bot token, starts with `xoxb-`.
- `HAIKPHEUS_STATE_URL`: Worker URL, for example `https://haikpheus.example.workers.dev`. `/state` is added automatically when omitted.
- `HAIKPHEUS_STATE_TOKEN`: shared secret used by GitHub Actions to read Worker state.

## Worker Secrets

Deploy `worker.js` to Cloudflare Workers with these secrets/vars:

- `SLACK_SIGNING_SECRET`: Slack app signing secret.
- `SLACK_BOT_TOKEN`: Slack bot token, starts with `xoxb-`.
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
