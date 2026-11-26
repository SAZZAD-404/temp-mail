# Temp Mail

Disposable / temporary email on Stella's own domain:

- `toolkitgen.xyz`

Update 2026-11-27: `toolkithub.site` was added at Stella's explicit choice. Its MX records previously pointed to Google Workspace — enabling Cloudflare Email Routing there replaces them, so Google mail for toolkithub.site stops and temp mail takes over.

## How it works

1. The website generates a random inbox, e.g. `blue-tiger-4821@toolkitgen.xyz`.
2. Mail sent to that address hits Cloudflare Email Routing.
3. Email Routing's catch-all rule sends every message to the Cloudflare Worker in `worker/`.
4. The Worker parses the message and stores it in KV (`TEMP_MAIL`).
5. The frontend polls the Worker API and shows the inbox live. No sign-up, no password.

Messages expire after 1 hour and are deleted automatically. Nothing is sent from this service — it only receives.

## Project layout

```
frontend/          Static site, deployed to Vercel
  index.html
  css/style.css
  js/config.js     API base URL + domains (edit after Worker deploy)
  js/app.js
worker/            Cloudflare Worker — receives mail + serves the API
  wrangler.toml
  package.json
  src/index.js
```

## Setup (one time, in Cloudflare)

1. In Cloudflare, for **both** `toolkitgen.xyz` and `toolkithub.site`:
   - Enable **Email Routing** and add a catch-all rule pointing to the Worker `temp-mail-worker`.
   - Email Routing will add the required MX records automatically — do not add MX records by hand.
2. Create a KV namespace called `TEMP_MAIL` and bind it in `worker/wrangler.toml`.
3. Deploy the Worker:
   ```
   cd worker
   npx wrangler deploy
   ```
   Note the Worker URL, e.g. `https://temp-mail-worker.<account>.workers.dev`
4. Put that URL in `frontend/js/config.js` as `API_BASE`.
5. Deploy `frontend/` to Vercel.

## Local preview

Open `frontend/index.html` in a browser. Inbox generation works offline; receiving mail needs the Worker + Email Routing live.
