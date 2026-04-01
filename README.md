# NB Code

[![Bun](https://img.shields.io/badge/Bun-1.3.11%2B-black)](https://bun.sh/)
[![Platform](https://img.shields.io/badge/platform-Windows-blue)](https://www.microsoft.com/windows)
[![Release](https://img.shields.io/github/v/release/Asnhanx/nb-code)](https://github.com/Asnhanx/nb-code/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

English | [简体中文](./README.zh-CN.md)

NB Code is a terminal coding assistant CLI with a customized startup experience, local-friendly workflow, and OpenAI-compatible API support.

It is designed for interactive terminal use on Windows, keeps the REPL-style coding flow, and adds a simple `/api` command for switching to OpenAI-compatible providers.

## Overview

- Customized command name: `asnhanx`
- Customized startup branding: `NB Code`
- Interactive terminal UI built with Bun and React/Ink
- Support for local development, build, and direct CLI execution
- OpenAI-compatible API configuration and model discovery
- `/model` integration after `/api` setup

## Installation

### Requirements

- Git
- Bun `>= 1.3.11`
- Node.js `>= 18`
- Windows PowerShell or another supported terminal

### 1. Clone the Repository

```bash
git clone https://github.com/Asnhanx/nb-code.git
cd nb-code
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Start in Development Mode

```bash
bun run dev
```

This launches the interactive CLI directly from source.

### 4. Start the CLI Directly

```bash
bun run src/entrypoints/cli.tsx
```

### 5. Build the Production Bundle

```bash
bun run build
```

Build output is written to:

```text
dist/cli.js
```

You can run the built bundle with:

```bash
bun dist/cli.js --help
```

### Optional: Start with a Custom Global Launcher

If you have already created a wrapper, alias, or PATH entry on your own machine, you can launch NB Code from any directory with:

```bash
asnhanx
```

The repository itself does not require a global install in order to run.

## Common Usage

### Check Version

```bash
asnhanx --version
```

### View Help

```bash
asnhanx --help
```

### Print Mode

```bash
asnhanx -p "Explain this repository"
```

### Continue the Latest Session

```bash
asnhanx --continue
```

### Recommended Working Directory

For the best interactive experience, start NB Code inside a project directory. Starting from your home directory still works, but the welcome screen keeps the reminder that a project folder is recommended.

## OpenAI-Compatible API

NB Code supports OpenAI-compatible endpoints and can fetch the available model list from the configured provider.

### Inspect the Current API Status

```text
/api
```

This shows the current mode, base URL, default model, auth status, and cached model count.

### Configure in the CLI

```text
/api set <base-url> <api-key> [model]
```

Example:

```text
/api set https://example.com/v1 YOUR_API_KEY gpt-5.4
```

### Refresh the Model List

```text
/api refresh
```

### Clear the Local API Configuration

```text
/api clear
```

### Switch Models

After `/api` is configured, use:

```text
/model
```

to inspect and switch among the models returned by the current endpoint.

### Important Notes

- `/api` is treated as a sensitive command, so its arguments are not written into session history.
- If no base URL is configured, the default OpenAI-compatible endpoint falls back to `https://api.openai.com/v1`.
- API keys saved through `/api` are stored in local user settings rather than in this repository.

## Repository Layout

```text
src/        Main CLI source code
packages/   Workspace packages
scripts/    Helper scripts
fixtures/   Local fixtures
dist/       Build output
```

## Development Notes

- The CLI currently builds successfully with Bun on Windows.
- `asnhanx --version` and `asnhanx --help` are both working.
- The startup screen has been customized to always show the full welcome layout in normal interactive use.

## Security Notes

- Do not commit API keys, tokens, certificates, or private local settings.
- Common secret-like files are ignored by `.gitignore`.
- This repository does not ship with hard-coded runtime API keys.
- If you configure an API key through `/api`, it is stored in your local user settings, not in this repository.

## Release

Public versions are published on GitHub Releases:

- <https://github.com/Asnhanx/nb-code/releases>

## License

This project is released under the [MIT License](./LICENSE).
