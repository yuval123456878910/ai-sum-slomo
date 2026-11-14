# Stress Radar

A research bot plus a website. It scans Israeli industrial companies for financial and operational stress in five sectors: plastics, food, packaging, chemicals and metal. It also scores how likely each case is to become a real-estate or business deal. Scans run at **07:00 and 19:00 Israel time**, and you can also start one with the **Run scan now** button.

- **Research**: OpenRouter chat model + OpenRouter web-search plugin. Each sector is its own call. A company gets one primary sector. Repeat findings are marked as *update* (not *new*) and keep their sector across runs.
- **Storage**: a JSON file on a Render persistent disk (`/var/data`).
- **Login**: HTTP basic auth (`ADMIN_USER` / `ADMIN_PASSWORD`).

## Deploy on Render

1. Push this folder to a GitHub repo.
2. In Render: **New → Blueprint**, then pick the repo. Render reads `render.yaml`.
3. Render asks for:
   - `OPENROUTER_API_KEY`: your key from https://openrouter.ai/keys
   - `ADMIN_PASSWORD`: the password for the site
4. Deploy. The service uses the *Starter* plan with a 1 GB disk. A free instance would sleep and miss the scheduled scans.

Change the key later: Render → service → **Environment** → edit `OPENROUTER_API_KEY` (redeploys automatically), or paste a key in the site's **Settings** tab.
Change the model: **Settings → Model** (lists every OpenRouter model) or the `OPENROUTER_MODEL` env var. `auto` = newest Claude Sonnet.

## Run locally

```bash
npm install
npm run seed-demo   # optional: 3 fictional findings to preview the UI
npm start           # http://localhost:3000
```

## Cost

Each scan makes 5 model calls with web search, twice a day. That comes to about 300 calls a month. Check the price of the model you choose on OpenRouter. The web plugin adds a small fee per search.
