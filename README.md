# RLMChat

RLMChat is a production-oriented chat app that brings Recursive Language Models (RLMs) into a polished web UI with OpenRouter-compatible model selection, persistent conversation-scoped RLM sessions, and traceable recursive execution.

It is designed for people who want a normal chat experience on the surface, while still being able to inspect how an RLM reasoned over external context underneath.

## What This Builds On Top Of

RLMChat is not built from scratch. It intentionally builds on top of two strong upstream projects:

- [`huggingface/chat-ui`](https://github.com/huggingface/chat-ui): the SvelteKit chat application and much of the surrounding product surface.
- [`alexzhang13/rlm`](https://github.com/alexzhang13/rlm): the Recursive Language Models runtime, REPL environment, persistence model, and recursive execution loop described in the paper.

This repository integrates those two systems into one application-focused stack:

- `chat-ui/` contains the web application fork and RLM-specific UI/server integration work.
- `rlm/` contains the bundled upstream RLM runtime used by the app.

## Features

- OpenRouter-compatible chat via `OPENAI_BASE_URL` and `OPENAI_API_KEY`
- Conversation-scoped persistent RLM sessions
- Separate root and worker model selection
- Inline RLM progress and expandable execution traces
- Durable session restoration across server restarts
- A chat-first interface instead of a research-demo surface

## Quickstart

1. Install dependencies:

```bash
npm install
cd chat-ui && npm install
```

2. Create a local env file:

```bash
cp chat-ui/.env.local.example chat-ui/.env.local
```

3. Fill in your provider settings. For OpenRouter, set:

```env
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=sk-or-v1-your-openrouter-key
RLM_ENABLED=true
```

4. Run the app:

```bash
npm run dev
```

## Repo Layout

- [`package.json`](/Users/alialharmoodi/Projects/RLMChat/package.json): top-level convenience scripts
- [`chat-ui`](/Users/alialharmoodi/Projects/RLMChat/chat-ui): the web app and integration layer
- [`rlm`](/Users/alialharmoodi/Projects/RLMChat/rlm): the bundled upstream RLM runtime
- [`THIRD_PARTY_NOTICES.md`](/Users/alialharmoodi/Projects/RLMChat/THIRD_PARTY_NOTICES.md): attribution and license notes

## Development Notes

- Sensitive local files such as `.env`, `.env.local`, `db/`, logs, caches, and generated session state are intentionally ignored.
- The checked-in examples are templates only; local credentials should never be committed.
- The RLM integration uses the actual Python runtime from `rlm/`, not a prompt-only simulation.

## Acknowledgements

This project exists because of the upstream work from the Hugging Face Chat UI team and the authors of Recursive Language Models. If you use this repo in research or product work, please also credit the upstream projects and the RLM paper.

