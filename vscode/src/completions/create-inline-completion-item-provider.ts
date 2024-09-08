import {
    NEVER,
    authStatus,
    combineLatest,
    createDisposables,
    mergeMap,
    promiseFactoryToObservable,
    resolvedConfig,
    vscodeResource,
} from '@sourcegraph/cody-shared'
import * as vscode from 'vscode'

import { logDebug } from '../log'
import type { CodyStatusBar } from '../services/StatusBar'

import { type Observable, map } from 'observable-fns'
import type { BfgRetriever } from './context/retrievers/bfg/bfg-retriever'
import { InlineCompletionItemProvider } from './inline-completion-item-provider'
import { createProvider } from './providers/create-provider'
import { registerAutocompleteTraceView } from './tracer/traceView'

export interface InlineCompletionItemProviderArgs {
    statusBar: CodyStatusBar
    createBfgRetriever?: () => BfgRetriever
}

/**
 * Inline completion item providers that always returns an empty reply.
 * Implemented as a class instead of anonymous function so that you can identify
 * it with `console.log()` debugging.
 */
class NoopCompletionItemProvider implements vscode.InlineCompletionItemProvider {
    public provideInlineCompletionItems(
        _document: vscode.TextDocument,
        _position: vscode.Position,
        _context: vscode.InlineCompletionContext,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
        return { items: [] }
    }
}

export function createInlineCompletionItemProvider({
    statusBar,
    createBfgRetriever,
}: InlineCompletionItemProviderArgs): Observable<void> {
    return combineLatest([resolvedConfig, authStatus]).pipe(
        mergeMap(([{ configuration: config }, authStatus]) => {
            if (!authStatus.authenticated) {
                logDebug('CodyCompletionProvider:notSignedIn', 'You are not signed in.')

                if (config.isRunningInsideAgent) {
                    // Register an empty completion provider when running inside the
                    // agent to avoid timeouts because it awaits for an
                    // `InlineCompletionItemProvider` to be registered.
                    return vscodeResource(() =>
                        vscode.languages.registerInlineCompletionItemProvider(
                            '*',
                            new NoopCompletionItemProvider()
                        )
                    )
                }

                return NEVER
            }

            return promiseFactoryToObservable(async () => {
                return await getInlineCompletionItemProviderFilters(config.autocompleteLanguages)
            }).pipe(
                mergeMap(documentFilters =>
                    createProvider().pipe(
                        createDisposables(provider => {
                            if (provider) {
                                const triggerDelay =
                                    vscode.workspace
                                        .getConfiguration()
                                        .get<number>('cody.autocomplete.triggerDelay') ?? 0
                                const completionsProvider = new InlineCompletionItemProvider({
                                    triggerDelay,
                                    provider,
                                    firstCompletionTimeout: config.autocompleteFirstCompletionTimeout,
                                    statusBar,
                                    completeSuggestWidgetSelection:
                                        config.autocompleteCompleteSuggestWidgetSelection,
                                    formatOnAccept: config.autocompleteFormatOnAccept,
                                    disableInsideComments: config.autocompleteDisableInsideComments,
                                    isRunningInsideAgent: config.isRunningInsideAgent,
                                    createBfgRetriever,
                                })

                                return [
                                    vscode.commands.registerCommand(
                                        'cody.autocomplete.manual-trigger',
                                        () => completionsProvider.manuallyTriggerCompletion()
                                    ),
                                    vscode.languages.registerInlineCompletionItemProvider(
                                        [{ notebookType: '*' }, ...documentFilters],
                                        completionsProvider
                                    ),
                                    registerAutocompleteTraceView(completionsProvider),
                                    completionsProvider,
                                ]
                            }
                            if (config.isRunningInsideAgent) {
                                throw new Error(
                                    `Can't register completion provider because \`providerConfig\` evaluated to \`null\`. To fix this problem, debug why createProvider returned null instead of ProviderConfig. To further debug this problem, here is the configuration:\n${JSON.stringify(
                                        config,
                                        null,
                                        2
                                    )}`
                                )
                            }
                            return []
                        })
                    )
                ),
                map(() => undefined)
            )
        })
    )
}

// Languages which should be disabled, but they are not present in
// https://code.visualstudio.com/docs/languages/identifiers#_known-language-identifiers
// But they exist in the `vscode.languages.getLanguages()` return value.
//
// To avoid confusing users with unknown language IDs, we disable them here programmatically.
const DISABLED_LANGUAGES = new Set(['scminput'])

export async function getInlineCompletionItemProviderFilters(
    autocompleteLanguages: Record<string, boolean>
): Promise<vscode.DocumentFilter[]> {
    const { '*': isEnabledForAll, ...perLanguageConfig } = autocompleteLanguages
    const languageIds = await vscode.languages.getLanguages()

    return languageIds.flatMap(language => {
        const enabled =
            !DISABLED_LANGUAGES.has(language) && language in perLanguageConfig
                ? perLanguageConfig[language]
                : isEnabledForAll

        return enabled ? [{ language, scheme: 'file' }] : []
    })
}
