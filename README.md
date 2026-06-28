# ⚡ QuickSend — Instant File Transfer

QuickSend is a minimal relay-based file transfer utility that streams files between a sender and a receiver in real time. Files are relayed through the server without being written to disk: sessions are single-use and automatically destroyed after successful delivery or expiration.

Supported files: any file type. Small chunked streaming keeps memory usage low and enables transfer across devices on the same network.

**Key files:** [server.js](server.js), [public/index.html](public/index.html), [public/receive.html](public/receive.html), [package.json](package.json)

## Quick Start

Prerequisites: Node.js (16+), npm

Install dependencies and run locally:

```bash
npm install
npm start
# Open http://localhost:3000
```

You can change the port with `PORT`, e.g. `PORT=8080 npm start`.

## How it works (overview)

1. Sender selects a file in the web UI and clicks **Generate Transfer Link**.
2. Server creates a 12-character token and stores session metadata in memory.
3. Sender's browser streams the file to the server in small chunks via Socket.IO.
4. When the receiver connects with the token (or uses the link), the server relays chunks from sender to receiver in real time.
5. After the last chunk, the session is destroyed — no file remains on disk.

Architecture (simplified):

```
Sender browser ──chunks──▶ Relay server (in-memory session) ──chunks──▶ Receiver browser
```

## Usage (send & receive)

- Send:
      1. Open the app at `/` (root). Drag & drop a file or browse to select one.
      2. Click **Generate Transfer Link**. You will get a 12-char token and a direct link.
      3. Share the token or link with the recipient.
- Receive:
      1. Open the direct link (`/receive?token=...`) or go to `/receive` and paste the token.
      2. The page will connect automatically and stream the file when the sender begins.
      3. After the transfer completes the file is available for download and the session is removed.

## Configuration & API

- Environment:
      - `PORT` — server port (default: `3000`).

- HTTP endpoints:
      - `GET /` — sender UI (serve static `public/index.html`).
      - `GET /receive` — receiver UI (`public/receive.html`).
      - `GET /api/host` — returns the server IP and port used by the frontend.

## Implementation details & limits

- Chunking: client uses 256KB chunks (`CHUNK_SIZE = 256 * 1024`) to stream files.
- Server Socket.IO config sets `maxHttpBufferSize` to `50 * 1024 * 1024` (50 MB). The frontend mentions 500MB as a guideline, but the server buffer currently limits large single messages — transfers use many small chunks, so total file size can be much larger than this setting, but you should verify memory and socket limits for very large files.
- Token TTL: tokens expire after 10 minutes (config in `server.js`). Tokens are 12 uppercase alphanumeric characters.
- Storage: sessions are stored in-memory (Map). There is no persistence — restarting the server invalidates active sessions.

## Security & privacy notes

- No disk writes: files are streamed through memory only and cleared after transfer or expiry.
- Single-use tokens: links cannot be reused after a successful transfer.
- Consider using HTTPS / TLS in production (reverse proxy or manage certs) to protect data in transit.

## Development

- Run locally: `npm install && npm start`.
- Linting/tests: none included by default. The frontend is vanilla HTML/CSS/JS.

## Suggested improvements

- Add rate limiting and per-session memory caps to protect the relay from large concurrent transfers.
- Add optional server-side logging for diagnostics (avoid logging file contents).
- Make the buffer/limit values configurable via env vars (e.g. `MAX_HTTP_BUFFER_SIZE`).

## License

MIT — feel free to reuse and adapt.

---
If you'd like, I can also update the code to make `maxHttpBufferSize` configurable, add a small health endpoint, or sync the frontend's advertised max file size with the server settings. Which change do you want next?
# quicksend
