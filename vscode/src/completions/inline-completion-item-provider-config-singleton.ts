import type { CodyStatusBar } from '../services/StatusBar'
import type { BfgRetriever } from './context/retrievers/bfg/bfg-retriever'
import type { Provider } from './providers/provider'
import type { ProvideInlineCompletionItemsTracer } from './tracer'

export interface CodyCompletionItemProviderConfig {
    provider: Provider
    firstCompletionTimeout: number
    statusBar: CodyStatusBar
    tracer?: ProvideInlineCompletionItemsTracer | null
    isRunningInsideAgent?: boolean

    createBfgRetriever?: () => BfgRetriever

    // Settings
    formatOnAccept?: boolean
    disableInsideComments?: boolean
    triggerDelay: number

    // Feature flags
    completeSuggestWidgetSelection?: boolean

    // Flag to check if the current request is also triggered for multiple providers.
    // When true it means the inlineCompletion are triggered for multiple model for comparison purpose.
    // Check `createInlineCompletionItemFromMultipleProviders` method in create-inline-completion-item-provider for more detail.
    noInlineAccept?: boolean
}

export type InlineCompletionItemProviderConfig = Omit<
    CodyCompletionItemProviderConfig,
    'createBfgRetriever'
>

/**
 * A singleton that manages the configuration for the inline completion item provider.
 * The configuration is set using the `set` method, and can be accessed using the `configuration` getter.
 * If the configuration has not been set, an error will be thrown when accessing the `configuration` getter.
 */
export const InlineCompletionItemProviderConfigSingleton = {
    _configuration: null as InlineCompletionItemProviderConfig | null,
    get configuration(): InlineCompletionItemProviderConfig {
        if (!InlineCompletionItemProviderConfigSingleton._configuration) {
            throw new Error('InlineCompletionItemProviderConfigSingleton not initialized')
        }
        return InlineCompletionItemProviderConfigSingleton._configuration
    },

    set(config: InlineCompletionItemProviderConfig): void {
        InlineCompletionItemProviderConfigSingleton._configuration = config
    },
}
