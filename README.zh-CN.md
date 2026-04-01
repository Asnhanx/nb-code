# NB Code

[![Bun](https://img.shields.io/badge/Bun-1.3.11%2B-black)](https://bun.sh/)
[![Platform](https://img.shields.io/badge/platform-Windows-blue)](https://www.microsoft.com/windows)
[![Release](https://img.shields.io/github/v/release/Asnhanx/nb-code)](https://github.com/Asnhanx/nb-code/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

[English](./README.md) | 简体中文

NB Code 是一个终端编码助手 CLI，带有定制化启动界面、本地优先工作流，以及 OpenAI 兼容 API 支持。

它面向 Windows 终端中的交互式使用场景，保留了 REPL 风格的编码体验，并增加了简单的 `/api` 命令来切换 OpenAI 兼容服务。

## 项目概览

- 定制启动命令：`asnhanx`
- 定制欢迎品牌：`NB Code`
- 基于 Bun 和 React/Ink 的交互式终端界面
- 支持本地开发、构建和直接运行
- 支持 OpenAI 兼容 API 配置和模型发现
- 在 `/api` 配置完成后可直接配合 `/model` 使用

## 安装说明

### 环境要求

- Git
- Bun `>= 1.3.11`
- Node.js `>= 18`
- Windows PowerShell 或其他受支持终端

### 1. 克隆仓库

```bash
git clone https://github.com/Asnhanx/nb-code.git
cd nb-code
```

### 2. 安装依赖

```bash
bun install
```

### 3. 开发模式启动

```bash
bun run dev
```

这个命令会直接从源码启动交互式 CLI。

### 4. 直接运行 CLI

```bash
bun run src/entrypoints/cli.tsx
```

### 5. 构建发布产物

```bash
bun run build
```

构建产物会输出到：

```text
dist/cli.js
```

构建完成后，也可以直接运行产物：

```bash
bun dist/cli.js --help
```

### 可选：使用自定义全局启动命令

如果你已经在自己的机器上配置好了包装脚本、别名或 PATH，也可以在任意目录直接输入：

```bash
asnhanx
```

仓库本身并不强制要求全局安装才可运行。

## 常见用法

### 查看版本

```bash
asnhanx --version
```

### 查看帮助

```bash
asnhanx --help
```

### 打印模式

```bash
asnhanx -p "Explain this repository"
```

### 继续最近一次会话

```bash
asnhanx --continue
```

### 建议的启动目录

为了获得更好的交互体验，建议在项目目录中启动 NB Code。即使你在主目录中启动，程序也仍然可以运行，只是欢迎页会继续提示你优先在项目目录中使用。

## OpenAI 兼容 API

NB Code 支持接入 OpenAI 兼容接口，并能从当前配置的服务端拉取可用模型列表。

### 查看当前 API 状态

```text
/api
```

这个命令会显示当前模式、Base URL、默认模型、认证状态以及模型缓存数量。

### 在 CLI 中配置

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

### 切换模型

在 `/api` 配置完成后，可以使用：

```text
/model
```

查看并切换当前接口返回的模型。

### 重要说明

- `/api` 被视为敏感命令，因此参数不会写入会话历史。
- 如果没有显式配置 Base URL，默认会回退到 `https://api.openai.com/v1`。
- 通过 `/api` 保存的 API Key 会写入本机用户配置，不会写入这个仓库。

## 仓库结构

```text
src/        CLI 主源码
packages/   工作区包
scripts/    辅助脚本
fixtures/   本地测试数据
dist/       构建输出
```

## 开发说明

- 当前项目已经可以在 Windows 上用 Bun 正常构建。
- `asnhanx --version` 和 `asnhanx --help` 都已经验证可用。
- 交互启动页已调整为正常情况下始终显示完整欢迎布局。

## 安全说明

- 不要把 API Key、令牌、证书或本地私有设置提交进仓库。
- `.gitignore` 已忽略常见敏感文件类型。
- 这个仓库本身不包含硬编码运行时 API Key。
- 如果你通过 `/api` 在本机配置过 API Key，它会保存到你的本地用户设置里，不会写入这个仓库。

## 发布说明

公开版本会发布在 GitHub Releases 页面：

- <https://github.com/Asnhanx/nb-code/releases>

## 许可证

本项目使用 [MIT License](./LICENSE)。
