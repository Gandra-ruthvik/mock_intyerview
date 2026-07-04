# Rehearsal Room — AI Mock Interview

A voice-based mock interview app: pick a role, answer questions out loud,
get scored on relevance, technical accuracy, communication, and confidence.

Runs entirely in the browser — no backend, no API keys, no build step.

## Files

- `index.html` — page structure
- `style.css` — all styling
- `script.js` — app logic (auth, question bank, speech recognition, scoring)

## Run it in VS Code

The microphone will **not** work if you just double-click `index.html`
and open it as a `file://` page — browsers block mic access on insecure
origins. Serve it over `http://localhost` instead:

**Option A — Live Server extension (easiest)**
1. Install the "Live Server" extension in VS Code.
2. Right-click `index.html` → "Open with Live Server".
3. It opens at something like `http://127.0.0.1:5500` — mic will work here.

**Option B — Python's built-in server**
```bash
cd mock-interview-app
python3 -m http.server 8000
```
Then open `http://localhost:8000` in Chrome or Edge.

**Option B — Node's `serve`**
```bash
npx serve .
```
Then open the printed `http://localhost:...` URL.

## Notes / known limitations

- **Speech recognition** uses the browser's built-in `SpeechRecognition` API
  (Chrome/Edge desktop). It is not supported in all browsers (notably not in
  Firefox, and inconsistently on some mobile browsers).
- **Accounts (register/login)** are stored in memory only, for the current
  tab — reloading the page clears them. This is a demo auth flow, not a real
  backend: passwords aren't hashed or persisted anywhere.
- **Question generation and scoring are fully offline** — a built-in question
  bank per role, and a heuristic scoring engine (keyword overlap, speaking
  pace, filler-word detection, structure cues). No network calls are made,
  so nothing here can fail due to API/network issues.
