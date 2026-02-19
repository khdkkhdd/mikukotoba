# JP Helper

Chrome extension for Japanese language learning: furigana overlay, translation, and vocabulary management.

## Stack

TypeScript, Vite, Chrome Extension Manifest V3 (CRXJS plugin).
Translation: Papago + LLM (Claude/OpenAI/Gemini). Morphology: Kuromoji + Kuroshiro.

## Build

- dev: `npm run dev` (vite build --watch)
- build: `npm run build` (tsc --noEmit && vite build)
- output: `dist/`

## Communication

Use Korean for all user-facing text: commit messages, documentation, comments, PR descriptions, UI strings.

## Documentation

Feature specs go in `docs/` as user-perspective descriptions of what users can do and how things behave. No code references, data models, or implementation details in feature specs.

Decisions go in `decisions/` using the numbered format (NNNN-topic.md).

Task context lives in `context.md` at repo root.

## Refactoring

Currently in refactoring phase. Read `docs/refactoring-guide.md` first — it contains the complete plan with step-by-step instructions, code examples, and verification criteria. Progress is tracked in `context.md`.
