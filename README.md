# NB Code

English | [简体中文](./README.zh-CN.md)

NB Code is a terminal coding assistant CLI built from the source code in this repository and customized for a local-first workflow on Windows.

It keeps the interactive terminal experience, supports multiple model backends, and adds OpenAI-compatible API switching through `/api`.

## Highlights

- Interactive terminal UI powered by Bun and React/Ink
- Command name customized to `asnhanx`
- Welcome screen and onboarding text customized for `NB Code`
- Supports Anthropic-style flows plus OpenAI-compatible API routing
- `/api` command for configuring `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and the default model
- `/model` can switch among models returned by the configured OpenAI-compatible endpoint

## Requirements

- Bun `>= 1.3.11`
- Node.js `>= 18`
- Windows PowerShell or another supported terminal

## Install

```bash
bun install
```

## Run

```bash
# development mode
bun run dev

# direct entry
bun run src/entrypoints/cli.tsx

# custom command configured in this project
asnhanx
```

## Build

```bash
bun run build
```

The build output is written to `dist/`.

## OpenAI-Compatible API

NB Code supports OpenAI-compatible endpoints.

### Configure inside the CLI

```text
/api set <base-url> <api-key> [model]
```

Example:

```text
/api set https://example.com/v1 YOUR_API_KEY gpt-5.4
```

### Refresh model list

```text
/api refresh
```

### Clear local API config

```text
/api clear
```

After configuration, use `/model` to inspect and switch models.

## Security Notes

- Do not commit API keys, tokens, certificates, or local settings files.
- Common secret-like files are ignored by `.gitignore`.
- This repository does not ship with hard-coded runtime API keys.
- If you configured an API key locally with `/api`, that value is stored in your local user settings, not in this repository.

## Project Structure

```text
src/        Main CLI source code
packages/   Workspace packages
scripts/    Helper scripts
dist/       Build output
```

## Development Notes

- `asnhanx --version` prints the customized CLI version string.
- `asnhanx --help` prints the customized CLI help text.
- The project currently builds with Bun on Windows.

## License

Review and apply a license that matches your redistribution plan before publishing.
