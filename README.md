# Arbiter

Arbiter is the start of an AI-based 2D RTS browser game prototype built with TypeScript, Vite, Phaser 4, and OpenRouter.

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Populate `.env`:

   ```bash
   OPENROUTER_API_KEY=your_openrouter_key
   OPENROUTER_MODEL=your_openrouter_model
   PORT=8787
   ```

3. Start the local game and API server:

   ```bash
   npm run dev
   ```

The Vite client runs at `http://localhost:5173` and proxies `/api/chat` to the local OpenRouter server on port `8787`.
