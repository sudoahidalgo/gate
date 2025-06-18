# Gate Control System

This project contains a simple Node.js server and a set of Netlify Functions to
control and log gate access. The server and functions rely on a Supabase
backend for storing codes and logs.

## Prerequisites

- **Node.js v18** – The Netlify build configuration specifies Node version `18`.
- **Netlify CLI** – Required if you want to run the Netlify Functions locally.
  Install globally with `npm install -g netlify-cli` or use it via `npx`.

Run `npm install` to install the project dependencies.

## Environment Variables

Both the local server and the Netlify Functions need access to Supabase and
some configuration details. Define the following variables:

- `SUPABASE_URL` – URL of your Supabase instance.
- `SUPABASE_SERVICE_KEY` – Service role key with access to your database.
- `TIMEZONE` – IANA time zone used when validating code schedules. If not set,
  the server's local time zone is used.

When deploying to Netlify, set these variables in the **Site settings →
Environment variables** section of the Netlify dashboard. Remember to define
`TIMEZONE` so that schedule restrictions are evaluated correctly. For local
development, create a `.env` file in the project root with the variables in the
form:

```bash
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_KEY=your-service-key
```

## Running Locally

### Start the Node server

The simple HTTP server defined in `server.js` can be started with:

```bash
node server.js
```

The server listens on port `3000` by default.

### Run Netlify Functions locally

Use the Netlify CLI to serve the functions and emulate Netlify redirects:

```bash
netlify dev
```

This will watch the files inside `netlify/functions/` and expose them under the
configured routes.
