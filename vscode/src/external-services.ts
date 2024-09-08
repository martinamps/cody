import type * as vscode from 'vscode'

import {
    ChatClient,
    type Guardrails,
    type SourcegraphCompletionsClient,
    SourcegraphGuardrailsClient,
    type StoredLastValue,
    currentAuthStatusAuthed,
    graphqlClient,
    isError,
    resolvedConfig,
    subscriptionDisposable,
    take,
} from '@sourcegraph/cody-shared'
import { ContextAPIClient } from './chat/context/contextAPIClient'
import type { PlatformContext } from './extension.common'
import type { LocalEmbeddingsController } from './local-context/local-embeddings'
import type { SymfRunner } from './local-context/symf'
import { logDebug, logger } from './log'

interface ExternalServices {
    chatClient: ChatClient
    completionsClient: SourcegraphCompletionsClient
    guardrails: Guardrails
    localEmbeddings: StoredLastValue<LocalEmbeddingsController | undefined> | undefined
    symfRunner: SymfRunner | undefined
    contextAPIClient: ContextAPIClient | undefined
    dispose(): void
}

export async function configureExternalServices(
    context: vscode.ExtensionContext,
    platform: Pick<
        PlatformContext,
        | 'createLocalEmbeddingsController'
        | 'createCompletionsClient'
        | 'createSentryService'
        | 'createOpenTelemetryService'
        | 'createSymfRunner'
    >
): Promise<ExternalServices> {
    const disposables: (vscode.Disposable | undefined)[] = []

    const sentryService = platform.createSentryService?.()
    if (sentryService) disposables.push(sentryService)

    const openTelemetryService = platform.createOpenTelemetryService?.()
    if (openTelemetryService) disposables.push(openTelemetryService)

    const completionsClient = platform.createCompletionsClient(logger)

    const symfRunner = platform.createSymfRunner?.(context, completionsClient)
    if (symfRunner) disposables.push(symfRunner)

    // TODO!(sqs): make these reactive
    resolvedConfig.pipe(take(1)).subscribe(async ({ configuration: initialConfiguration }) => {
        if (
            initialConfiguration.codebase &&
            isError(await graphqlClient.getRepoId(initialConfiguration.codebase))
        ) {
            logDebug(
                'external-services:configureExternalServices',
                `Cody could not find the '${initialConfiguration.codebase}' repository on your Sourcegraph instance.\nPlease check that the repository exists. You can override the repository with the "cody.codebase" setting.`
            )
        }
    })

    const localEmbeddings = platform.createLocalEmbeddingsController?.()
    if (localEmbeddings) disposables.push(subscriptionDisposable(localEmbeddings.subscription))

    const chatClient = new ChatClient(completionsClient, () => currentAuthStatusAuthed())
    const guardrails = new SourcegraphGuardrailsClient()
    const contextAPIClient = new ContextAPIClient(graphqlClient)

    return {
        chatClient,
        completionsClient,
        guardrails,
        localEmbeddings,
        symfRunner,
        contextAPIClient,
        dispose(): void {
            for (const d of disposables) {
                d?.dispose()
            }
        },
    }
}
