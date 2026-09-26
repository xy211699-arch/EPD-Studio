# ChatGPT Codex quota adapter

The local server exposes `GET /__quota`. It starts the installed official Codex `app-server` over stdio and calls its `account/rateLimits/read` JSON-RPC method. Codex itself loads and refreshes the local ChatGPT authentication state; this project never reads or forwards the token.

The browser receives only normalized `five_hour` and `seven_day` windows. The app-server command, authentication material, and upstream response details stay in the Python process and are never returned to the page or written to the repository.

The app-server protocol is an experimental local contract rather than a public OpenAI API. Missing authentication, network failures, incomplete responses, process startup failures, and protocol changes produce an unavailable state and `--` on the dashboard. The page refreshes on demand and every 30 minutes; it does not upload an image automatically.
