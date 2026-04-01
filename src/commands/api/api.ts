import axios from 'axios'
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js'
import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { applyConfigEnvironmentVariables } from '../../utils/managedEnv.js'
import { isModelAlias } from '../../utils/model/aliases.js'
import { renderModelName } from '../../utils/model/model.js'
import type { ModelOption } from '../../utils/model/modelOptions.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'
import {
  fetchOpenAICompatModelOptions,
  hasOpenAICompatAuthHeader,
  maskSecret,
  normalizeOpenAICompatBaseUrl,
  OpenAICompatAuthError,
  parseOpenAICompatHeaders,
} from '../../services/api/openaiCompatModels.js'

const OPENAI_COMPAT_ENV_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_OPENAI_COMPAT',
  'OPENAI_API_HEADERS',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
] as const

const PROVIDER_FLAG_KEYS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_VERTEX',
] as const

const HELP_TEXT = [
  'OpenAI 兼容 API 命令',
  '',
  '用法：',
  '/api',
  '/api set <base-url> <api-key> [model]',
  '/api <base-url> <api-key> [model]',
  '/api refresh',
  '/api clear',
  '',
  '说明：',
  '- 第三个参数可选，用来设置默认模型 ID，例如 gpt-5.4。',
  '- /api 已标记为敏感命令，参数不会写入会话历史。',
  '- 配置成功后，可直接用 /model 查看并切换这个接口返回的模型。',
].join('\n')

function deleteProcessEnv(keys: readonly string[]): void {
  for (const key of keys) {
    delete process.env[key]
  }
}

function applyOpenAICompatSessionEnv(config:
  | {
      apiKey: string
      baseUrl: string
      model: string
    }
  | null): void {
  deleteProcessEnv([...OPENAI_COMPAT_ENV_KEYS, ...PROVIDER_FLAG_KEYS])

  if (!config) {
    return
  }

  process.env.CLAUDE_CODE_USE_OPENAI_COMPAT = '1'
  process.env.OPENAI_BASE_URL = config.baseUrl
  process.env.OPENAI_API_KEY = config.apiKey
  process.env.OPENAI_MODEL = config.model
}

function saveModelCache(models: ModelOption[]): void {
  saveGlobalConfig(current => ({
    ...current,
    additionalModelOptionsCache: models,
  }))
}

function formatCurrentModel(model: string | null | undefined): string {
  if (!model) {
    return '未设置'
  }
  return renderModelName(model)
}

function getAppModelCandidate(
  currentModel: string | null | undefined,
): string | undefined {
  if (!currentModel) {
    return undefined
  }

  const trimmedModel = currentModel.trim()
  if (!trimmedModel || isModelAlias(trimmedModel.toLowerCase())) {
    return undefined
  }

  return trimmedModel
}

function validateBaseUrl(baseUrl: string): string {
  const normalizedBaseUrl = normalizeOpenAICompatBaseUrl(baseUrl)
  new URL(normalizedBaseUrl)
  return normalizedBaseUrl
}

function validatePreferredModel(model: string | undefined): string | undefined {
  const trimmedModel = model?.trim()
  if (!trimmedModel) {
    return undefined
  }

  if (
    trimmedModel.toLowerCase() === 'default' ||
    isModelAlias(trimmedModel.toLowerCase())
  ) {
    throw new Error(
      '默认模型必须填写接口真实模型 ID，例如 gpt-5.4，而不是 sonnet/opus/haiku 这类别名。',
    )
  }

  return trimmedModel
}

function formatApiError(error: unknown): string {
  if (error instanceof OpenAICompatAuthError) {
    return '认证信息缺失，请提供 API Key，或先配置带认证信息的 OPENAI_API_HEADERS。'
  }

  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    if (status) {
      return `请求失败，接口返回 HTTP ${status}。`
    }

    if (error.code === 'ECONNABORTED') {
      return '请求超时，请检查 Base URL 是否可访问。'
    }

    return error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function hasLocalCompatConfig(): boolean {
  const env = getSettingsForSource('userSettings')?.env
  if (!env) {
    return false
  }

  return Boolean(
    env.CLAUDE_CODE_USE_OPENAI_COMPAT ||
      env.OPENAI_BASE_URL ||
      env.OPENAI_API_KEY ||
      env.OPENAI_MODEL,
  )
}

function buildStatusText(context: Parameters<LocalCommandCall>[1]): string {
  const hasExternalCompatConfig =
    !!process.env.CLAUDE_CODE_USE_OPENAI_COMPAT ||
    !!process.env.OPENAI_BASE_URL ||
    !!process.env.OPENAI_API_KEY ||
    !!process.env.OPENAI_MODEL
  const localCompatConfig = hasLocalCompatConfig()
  const baseUrl = process.env.OPENAI_BASE_URL?.trim()
    ? normalizeOpenAICompatBaseUrl(process.env.OPENAI_BASE_URL)
    : '未设置（默认将使用 https://api.openai.com/v1）'
  const currentModel = getAppModelCandidate(context.getAppState().mainLoopModel)
  const defaultModel = process.env.OPENAI_MODEL?.trim() || '未设置'
  const apiKey =
    process.env.OPENAI_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim()
  const authHeaders = parseOpenAICompatHeaders(process.env.OPENAI_API_HEADERS)
  const maskedKey = maskSecret(apiKey)
  const authSummary = maskedKey
    ? maskedKey
    : hasOpenAICompatAuthHeader(authHeaders)
      ? '已通过自定义请求头配置'
      : '未配置'

  return [
    'OpenAI 兼容 API 当前状态',
    '',
    `模式：${getAPIProvider() === 'openaiCompat' ? '已启用' : '未启用'}`,
    `Base URL：${baseUrl}`,
    `默认模型：${defaultModel}`,
    `当前会话模型：${formatCurrentModel(currentModel ?? process.env.OPENAI_MODEL)}`,
    `认证：${authSummary}`,
    `模型缓存：${(getGlobalConfig().additionalModelOptionsCache ?? []).length} 个`,
    ...(!localCompatConfig && hasExternalCompatConfig
      ? [
          '来源：当前生效值来自外部环境变量，不是 /api 保存的本地配置。',
        ]
      : []),
    '',
    HELP_TEXT,
  ].join('\n')
}

async function handleSet(
  rawArgs: string,
  context: Parameters<LocalCommandCall>[1],
): Promise<LocalCommandResult> {
  const parts = rawArgs.trim().split(/\s+/)
  const hasSetKeyword = parts[0]?.toLowerCase() === 'set'
  const offset = hasSetKeyword ? 1 : 0
  const baseUrlArg = parts[offset]
  const apiKeyArg = parts[offset + 1]
  const modelArg = parts[offset + 2]

  if (!baseUrlArg || !apiKeyArg) {
    return {
      type: 'text',
      value: [
        '参数不完整。',
        '',
        '正确用法：',
        '/api set <base-url> <api-key> [model]',
        '/api <base-url> <api-key> [model]',
      ].join('\n'),
    }
  }

  let normalizedBaseUrl: string
  let preferredModel: string | undefined
  try {
    normalizedBaseUrl = validateBaseUrl(baseUrlArg)
    preferredModel = validatePreferredModel(modelArg)
  } catch (error) {
    return {
      type: 'text',
      value: formatApiError(error),
    }
  }

  const currentBaseUrl = normalizeOpenAICompatBaseUrl(process.env.OPENAI_BASE_URL)
  const currentAppModel = getAppModelCandidate(context.getAppState().mainLoopModel)
  const currentDefaultModel = process.env.OPENAI_MODEL?.trim() || undefined
  const shouldReuseCurrentModel =
    currentBaseUrl === normalizedBaseUrl && !preferredModel
  const requestedDefaultModel =
    preferredModel ??
    (shouldReuseCurrentModel
      ? currentAppModel || currentDefaultModel
      : undefined)

  try {
    const models = await fetchOpenAICompatModelOptions({
      apiKey: apiKeyArg,
      baseUrl: normalizedBaseUrl,
      preferredModel: requestedDefaultModel,
      rawHeaders: undefined,
      timeoutMs: 5000,
    })

    const selectedModel =
      requestedDefaultModel && models.some(model => model.value === requestedDefaultModel)
        ? requestedDefaultModel
        : models[0]?.value

    if (!selectedModel) {
      return {
        type: 'text',
        value:
          '接口连接成功，但没有拿到可用模型。请补一个默认模型，例如：/api set <base-url> <api-key> gpt-5.4',
      }
    }

    const updateResult = updateSettingsForSource('userSettings', {
      env: {
        CLAUDE_CODE_USE_BEDROCK: undefined,
        CLAUDE_CODE_USE_FOUNDRY: undefined,
        CLAUDE_CODE_USE_OPENAI: undefined,
        CLAUDE_CODE_USE_OPENAI_COMPAT: '1',
        CLAUDE_CODE_USE_VERTEX: undefined,
        OPENAI_API_HEADERS: undefined,
        OPENAI_API_KEY: apiKeyArg,
        OPENAI_BASE_URL: normalizedBaseUrl,
        OPENAI_MODEL: selectedModel,
      },
    })

    if (updateResult.error) {
      return {
        type: 'text',
        value: `保存配置失败：${updateResult.error.message}`,
      }
    }

    applyConfigEnvironmentVariables()
    applyOpenAICompatSessionEnv({
      apiKey: apiKeyArg,
      baseUrl: normalizedBaseUrl,
      model: selectedModel,
    })
    saveModelCache(models)

    context.setAppState(prev => {
      if (
        prev.mainLoopModel === selectedModel &&
        prev.mainLoopModelForSession === null
      ) {
        return prev
      }

      return {
        ...prev,
        mainLoopModel: selectedModel,
        mainLoopModelForSession: null,
      }
    })
    context.onChangeAPIKey()

    return {
      type: 'text',
      value: [
        'OpenAI 兼容 API 已配置完成。',
        `Base URL：${normalizedBaseUrl}`,
        `默认模型：${selectedModel}`,
        `模型缓存：${models.length} 个`,
        '现在可以直接使用 /model 查看并切换这个接口提供的模型。',
      ].join('\n'),
    }
  } catch (error) {
    return {
      type: 'text',
      value: `配置失败：${formatApiError(error)}`,
    }
  }
}

async function handleRefresh(
  context: Parameters<LocalCommandCall>[1],
): Promise<LocalCommandResult> {
  const apiKey =
    process.env.OPENAI_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim()
  const baseUrl = normalizeOpenAICompatBaseUrl(process.env.OPENAI_BASE_URL)
  const currentModel =
    getAppModelCandidate(context.getAppState().mainLoopModel) ||
    process.env.OPENAI_MODEL?.trim()

  if (!apiKey && !hasOpenAICompatAuthHeader(parseOpenAICompatHeaders(process.env.OPENAI_API_HEADERS))) {
    return {
      type: 'text',
      value:
        '当前没有完整的 OpenAI 兼容 API 认证信息，无法刷新。先运行 /api set <base-url> <api-key> [model]。',
    }
  }

  try {
    const models = await fetchOpenAICompatModelOptions({
      apiKey,
      baseUrl,
      preferredModel: currentModel,
      rawHeaders: process.env.OPENAI_API_HEADERS,
      timeoutMs: 5000,
    })

    saveModelCache(models)
    context.onChangeAPIKey()

    return {
      type: 'text',
      value: [
        '模型列表已刷新。',
        `Base URL：${baseUrl}`,
        `默认模型：${process.env.OPENAI_MODEL?.trim() || '未设置'}`,
        `模型缓存：${models.length} 个`,
        '现在可以使用 /model 查看最新模型列表。',
      ].join('\n'),
    }
  } catch (error) {
    return {
      type: 'text',
      value: `刷新失败：${formatApiError(error)}`,
    }
  }
}

function handleClear(
  context: Parameters<LocalCommandCall>[1],
): LocalCommandResult {
  const updateResult = updateSettingsForSource('userSettings', {
    env: {
      CLAUDE_CODE_USE_OPENAI: undefined,
      CLAUDE_CODE_USE_OPENAI_COMPAT: undefined,
      OPENAI_API_HEADERS: undefined,
      OPENAI_API_KEY: undefined,
      OPENAI_BASE_URL: undefined,
      OPENAI_MODEL: undefined,
    },
  })

  if (updateResult.error) {
    return {
      type: 'text',
      value: `清除配置失败：${updateResult.error.message}`,
    }
  }

  applyConfigEnvironmentVariables()
  applyOpenAICompatSessionEnv(null)
  saveModelCache([])

  context.setAppState(prev => {
    if (prev.mainLoopModel === null && prev.mainLoopModelForSession === null) {
      return prev
    }

    return {
      ...prev,
      mainLoopModel: null,
      mainLoopModelForSession: null,
    }
  })
  context.onChangeAPIKey()

  return {
    type: 'text',
    value: [
      '已清除本地 OpenAI 兼容 API 配置。',
      '当前会话已移除对应的 Base URL、API Key 和模型缓存。',
      '如果重新启动后仍显示已启用，说明系统或启动器环境变量里还有同名配置。',
    ].join('\n'),
  }
}

export const call: LocalCommandCall = async (args, context) => {
  const trimmedArgs = args.trim()

  if (!trimmedArgs || COMMON_INFO_ARGS.includes(trimmedArgs)) {
    return {
      type: 'text',
      value: buildStatusText(context),
    }
  }

  if (COMMON_HELP_ARGS.includes(trimmedArgs)) {
    return {
      type: 'text',
      value: HELP_TEXT,
    }
  }

  const firstToken = trimmedArgs.split(/\s+/, 1)[0]!.toLowerCase()

  if (firstToken === 'clear') {
    return handleClear(context)
  }

  if (firstToken === 'refresh') {
    return handleRefresh(context)
  }

  if (firstToken === 'set' || /^https?:\/\//i.test(trimmedArgs)) {
    return handleSet(trimmedArgs, context)
  }

  return {
    type: 'text',
    value: [
      `不支持的子命令：${trimmedArgs}`,
      '',
      HELP_TEXT,
    ].join('\n'),
  }
}
