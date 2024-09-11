import {
    type MultimodelSingleModelConfig,
    authStatus,
    combineLatest,
    createDisposables,
    resolvedConfig,
} from '@sourcegraph/cody-shared'
import { type Observable, map } from 'observable-fns'
import * as vscode from 'vscode'
import { logDebug } from '../log'
import type { InlineCompletionItemProviderArgs } from './create-inline-completion-item-provider'
import { InlineCompletionItemProvider } from './inline-completion-item-provider'
import { createProviderHelper } from './providers/create-provider'

export interface MultiModelCompletionsResults {
    provider: string
    model: string
    contextStrategy: string
    completion?: string
}

interface providerConfig {
    providerName: string
    modelName: string
    contextStrategy: string
    completionsProvider: InlineCompletionItemProvider
}

async function manuallyGetCompletionItemsForProvider(
    config: providerConfig,
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext
): Promise<MultiModelCompletionsResults> {
    const result = await config.completionsProvider.provideInlineCompletionItems(
        document,
        position,
        context,
        new vscode.CancellationTokenSource().token
    )
    const completion = result?.items[0].insertText?.toString() || ''
    return {
        provider: config.providerName,
        model: config.modelName,
        contextStrategy: config.contextStrategy,
        completion,
    }
}

async function triggerMultiModelAutocompletionsForComparison(
    allCompletionsProvidersConfig: providerConfig[]
) {
    const activeEditor = vscode.window.activeTextEditor
    if (!activeEditor) {
        return
    }
    const document = activeEditor.document
    const position = activeEditor.selection.active
    const context = {
        triggerKind: vscode.InlineCompletionTriggerKind.Automatic,
        selectedCompletionInfo: undefined,
    }
    const allPromises: Promise<MultiModelCompletionsResults>[] = []
    for (const completionsProviderConfig of allCompletionsProvidersConfig) {
        allPromises.push(
            manuallyGetCompletionItemsForProvider(completionsProviderConfig, document, position, context)
        )
    }
    const completions = await Promise.all(allPromises)
    let completionsOutput = ''
    for (const result of completions) {
        completionsOutput += `Model: ${result.model}\t Context: ${result.contextStrategy} \n${result.completion}\n\n`
    }
    logDebug('MultiModelAutoComplete:\n', completionsOutput)
}

/**
 * Creates multiple providers to get completions from. The primary purpose of this method is to get
 * the completions generated from multiple providers, which helps judge the quality of code
 * completions
 */
export function createInlineCompletionItemFromMultipleProviders({
    statusBar,
    createBfgRetriever,
}: InlineCompletionItemProviderArgs): Observable<void> {
    return combineLatest([resolvedConfig, authStatus]).pipe(
        createDisposables(([config, authStatus]) => {
            if (
                !authStatus.authenticated ||
                config.configuration.autocompleteExperimentalMultiModelCompletions === undefined
            ) {
                return []
            }

            const multiModelConfigsList: MultimodelSingleModelConfig[] = []
            for (const currentProviderConfig of config.configuration
                .autocompleteExperimentalMultiModelCompletions) {
                if (currentProviderConfig.provider && currentProviderConfig.model) {
                    multiModelConfigsList.push({
                        provider: currentProviderConfig.provider,
                        model: currentProviderConfig.model,
                        enableExperimentalFireworksOverrides:
                            currentProviderConfig.enableExperimentalFireworksOverrides ?? false,
                        context: currentProviderConfig.context,
                    })
                }
            }

            const allCompletionsProviders: providerConfig[] = []
            for (const currentProviderConfig of multiModelConfigsList) {
                const newConfig: typeof config = {
                    ...config,
                    configuration: {
                        ...config.configuration,
                        // Override some config to ensure we are not logging extra events.
                        telemetryLevel: 'off',
                        // We should only override the fireworks "cody.autocomplete.experimental.fireworksOptions" when added in the config.
                        autocompleteExperimentalFireworksOptions:
                            currentProviderConfig.enableExperimentalFireworksOverrides
                                ? config.configuration.autocompleteExperimentalFireworksOptions
                                : undefined,
                        // Don't use the advanced provider config to get the model
                        autocompleteAdvancedModel: null,
                        autocompleteExperimentalGraphContext: currentProviderConfig.context as
                            | 'lsp-light'
                            | 'bfg'
                            | 'bfg-mixed'
                            | 'tsc'
                            | 'tsc-mixed'
                            | null,
                    },
                }

                // Use the experimental config to get the context provider
                const provider = createProviderHelper({
                    authStatus,
                    legacyModel: currentProviderConfig.model,
                    provider: currentProviderConfig.provider,
                    config: newConfig,
                })

                if (provider) {
                    const triggerDelay =
                        vscode.workspace
                            .getConfiguration()
                            .get<number>('cody.autocomplete.triggerDelay') ?? 0
                    const completionsProvider = new InlineCompletionItemProvider({
                        provider,
                        triggerDelay: triggerDelay ?? 0,
                        firstCompletionTimeout: config.configuration.autocompleteFirstCompletionTimeout,
                        statusBar,
                        completeSuggestWidgetSelection:
                            config.configuration.autocompleteCompleteSuggestWidgetSelection,
                        formatOnAccept: config.configuration.autocompleteFormatOnAccept,
                        disableInsideComments: config.configuration.autocompleteDisableInsideComments,
                        isRunningInsideAgent: config.configuration.isRunningInsideAgent,
                        createBfgRetriever,
                        noInlineAccept: true,
                    })
                    allCompletionsProviders.push({
                        providerName: currentProviderConfig.provider,
                        modelName: currentProviderConfig.model,
                        completionsProvider: completionsProvider,
                        contextStrategy: currentProviderConfig.context,
                    })
                }
            }
            return [
                vscode.commands.registerCommand('cody.multi-model-autocomplete.manual-trigger', () =>
                    triggerMultiModelAutocompletionsForComparison(allCompletionsProviders)
                ),
                ...allCompletionsProviders.map(({ completionsProvider }) => completionsProvider),
            ]
        }),
        map(() => undefined)
    )
}
