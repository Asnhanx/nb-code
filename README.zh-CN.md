# NB Code

[English](./README.md) | 简体中文

NB Code 是这个仓库中的终端编码助手 CLI，当前版本针对本地优先、Windows 终端使用场景做了定制。

它保留了交互式终端体验，支持多种模型后端，并增加了通过 `/api` 切换 OpenAI 兼容接口的能力。

## 主要特性

- 基于 Bun 和 React/Ink 的交互式终端界面
- 启动命令已定制为 `asnhanx`
- 欢迎页和入门提示已定制为 `NB Code`
- 支持 Anthropic 风格流程和 OpenAI 兼容 API 路由
- 提供 `/api` 命令配置 `OPENAI_BASE_URL`、`OPENAI_API_KEY` 和默认模型
- 配置完成后可通过 `/model` 查看并切换接口返回的模型

## 环境要求

- Bun `>= 1.3.11`
- Node.js `>= 18`
- Windows PowerShell 或其他受支持终端

## 安装

```bash
bun install
```

## 运行

```bash
# 开发模式
bun run dev

# 直接运行入口
bun run src/entrypoints/cli.tsx

# 本项目定制命令
asnhanx
```

## 构建

```bash
bun run build
```

构建产物会输出到 `dist/`。

## OpenAI 兼容 API

NB Code 支持接入 OpenAI 兼容接口。

### 在 CLI 内配置

```text
/api set <base-url> <api-key> [model]
```

示例：

```text
/api set https://example.com/v1 YOUR_API_KEY gpt-5.4
```

### 刷新模型列表

```text
/api refresh
```

### 清除本地 API 配置

```text
/api clear
```

配置完成后，可以使用 `/model` 查看并切换模型。

## 安全说明

- 不要把 API Key、令牌、证书或本地设置文件提交进仓库。
- `.gitignore` 已忽略常见的敏感文件类型。
- 这个仓库本身不包含硬编码运行时 API Key。
- 如果你通过 `/api` 在本机配置过 API Key，它会保存到你的本地用户设置中，不会写入这个仓库。

## 项目结构

```text
src/        CLI 主源码
packages/   工作区包
scripts/    辅助脚本
dist/       构建输出
```

## 开发说明

- `asnhanx --version` 会输出定制后的版本信息。
- `asnhanx --help` 会输出定制后的帮助文本。
- 当前项目可在 Windows 上使用 Bun 正常构建。

## 许可证

在公开发布前，请补充一份和你的分发计划一致的许可证。
