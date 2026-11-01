// Where the online play server lives: the Cloudflare Worker in server/,
// deployed to Steven's workers.dev subdomain.
// For testing, ?server=ws://127.0.0.1:8787 on the page address overrides it.
export const SERVER_URL = 'wss://double-agents.stevengailey-sg.workers.dev';
