import type { Command } from '../../commands.js'

const api = {
  type: 'local',
  name: 'api',
  description: '配置 OpenAI 兼容 API 的 Base URL、API Key 和默认模型',
  argumentHint: '[set <base-url> <api-key> [model]|refresh|clear]',
  immediate: true,
  isSensitive: true,
  supportsNonInteractive: true,
  load: () => import('./api.js'),
} satisfies Command

export default api
