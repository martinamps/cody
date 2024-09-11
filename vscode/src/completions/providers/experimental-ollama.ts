import type * as vscode from 'vscode'

import {
    type AutocompleteContextSnippet,
    type OllamaGenerateParams,
    PromptString,
    createOllamaClient,
    distinctUntilChanged,
    firstValueFrom,
    ps,
    resolvedConfig,
} from '@sourcegraph/cody-shared'

import { logger } from '../../log'
import { getLanguageConfig } from '../../tree-sitter/language'
import { forkSignal, generatorWithTimeout, zipGenerators } from '../utils'

import { map } from 'observable-fns'
import { type DefaultModel, getModelHelpers } from '../model-helpers'
import { getSuffixAfterFirstNewline } from '../text-processing'
import {
    type FetchCompletionResult,
    fetchAndProcessDynamicMultilineCompletions,
} from './fetch-and-process-completions'
import {
    type CompletionProviderTracer,
    type GenerateCompletionsOptions,
    Provider,
    type ProviderContextSizeHints,
    type ProviderFactoryParams,
} from './provider'

interface OllamaPromptContext {
    snippets: AutocompleteContextSnippet[]
    context: PromptString
    currentFileNameComment: PromptString
    isInfill: boolean

    uri: vscode.Uri
    prefix: PromptString
    suffix: PromptString

    languageId: string
}

function fileNameLine(uri: vscode.Uri, commentStart: PromptString): PromptString {
    return ps`${commentStart} Path: ${PromptString.fromDisplayPath(uri)}\n`
}

/**
 * An *experimental* completion provider that uses [Ollama](https://ollama.ai), which is a tool for
 * running LLMs locally.
 *
 * The provider communicates with an Ollama server's [REST
 * API](https://github.com/jmorganca/ollama#rest-api).
 */
class ExperimentalOllamaProvider extends Provider {
    public contextSizeHints: ProviderContextSizeHints = {
        // We don't use other files as context yet in Ollama, so this doesn't matter.
        totalChars: 0,

        // Ollama evaluates the prompt at ~50 tok/s for codellama:7b-code on a MacBook Air M2.
        // If the prompt has a common prefix across inference requests, subsequent requests do
        // not incur prompt reevaluation and are therefore much faster. So, we want a large
        // document prefix that covers the entire document (except in cases where the document
        // is very, very large, in which case Ollama would not work well anyway).
        prefixChars: 10000,

        // For the same reason above, we want a very small suffix because otherwise Ollama needs to
        // reevaluate more tokens in the prompt. This is because the prompt is (roughly) `prefix
        // (cursor position) suffix`, so even typing a single character at the cursor position
        // invalidates the LLM's cache of the suffix.
        suffixChars: 100,
    }

    private ollamaOptions = resolvedConfig.pipe(
        map(config => config.configuration.autocompleteExperimentalOllamaOptions),
        distinctUntilChanged()
    )

    protected createPromptContext(
        options: GenerateCompletionsOptions,
        snippets: AutocompleteContextSnippet[],
        isInfill: boolean,
        modelHelper: DefaultModel
    ): OllamaPromptContext {
        const { languageId, uri } = options.document
        const config = getLanguageConfig(languageId)
        const commentStart = config?.commentStart || ps`// `
        const { prefix, suffix } = PromptString.fromAutocompleteDocumentContext(
            options.docContext,
            options.document.uri
        )

        const context = PromptString.join(
            snippets.map(snippet => {
                const contextPrompts = PromptString.fromAutocompleteContextSnippet(snippet)

                return fileNameLine(uri, commentStart).concat(
                    PromptString.join(
                        contextPrompts.content.split('\n').map(line => ps`${commentStart} ${line}`),
                        ps`\n`
                    )
                )
            }),
            ps`\n\n`
        )

        const currentFileNameComment = fileNameLine(uri, commentStart)

        const prompt: OllamaPromptContext = {
            snippets: [],
            uri,
            languageId,
            context,
            currentFileNameComment,
            isInfill,
            prefix,
            suffix: getSuffixAfterFirstNewline(suffix),
        }

        if (process.env.OLLAMA_CONTEXT_SNIPPETS) {
            // TODO(valery): find the balance between using context and keeping a good perf.
            const maxPromptChars = 1234

            for (const snippet of snippets) {
                const extendedSnippets = [...prompt.snippets, snippet]
                const promptLengthWithSnippet = modelHelper.getOllamaPrompt({
                    ...prompt,
                    snippets: extendedSnippets,
                }).length

                if (promptLengthWithSnippet > maxPromptChars) {
                    break
                }

                prompt.snippets = extendedSnippets
            }
        }

        return prompt
    }

    public async generateCompletions(
        options: GenerateCompletionsOptions,
        abortSignal: AbortSignal,
        snippets: AutocompleteContextSnippet[],
        tracer?: CompletionProviderTracer
    ): Promise<AsyncGenerator<FetchCompletionResult[]>> {
        const { docContext, multiline: isMultiline } = options

        // Only use infill if the suffix is not empty
        const useInfill = docContext.suffix.trim().length > 0

        const ollamaOptions = await firstValueFrom(this.ollamaOptions)

        const timeoutMs = 5_0000
        const modelHelpers = getModelHelpers(ollamaOptions.model)
        const promptContext = this.createPromptContext(options, snippets, useInfill, modelHelpers)

        const requestParams = {
            prompt: modelHelpers.getOllamaPrompt(promptContext),
            template: '{{ .Prompt }}',
            model: ollamaOptions.model,
            options: modelHelpers.getOllamaRequestOptions(isMultiline),
        } satisfies OllamaGenerateParams

        if (ollamaOptions.parameters) {
            Object.assign(requestParams.options, ollamaOptions.parameters)
        }

        // TODO(valery): remove `any` casts
        tracer?.params(requestParams as any)
        const ollamaClient = createOllamaClient(ollamaOptions, logger)

        const completionsGenerators = Array.from({ length: options.numberOfCompletionsToGenerate }).map(
            () => {
                const abortController = forkSignal(abortSignal)

                const completionResponseGenerator = generatorWithTimeout(
                    ollamaClient.complete(requestParams, abortController),
                    timeoutMs,
                    abortController
                )

                return fetchAndProcessDynamicMultilineCompletions({
                    completionResponseGenerator,
                    abortController,
                    providerSpecificPostProcess: insertText => insertText.trim(),
                    generateOptions: {
                        ...options,
                        // Increased first completion timeout value to account for the higher latency.
                        firstCompletionTimeout: 3_0000,
                    },
                })
            }
        )

        return zipGenerators(completionsGenerators)
    }
}

export function createProvider(params: ProviderFactoryParams): Provider {
    const { anonymousUserID } = params

    return new ExperimentalOllamaProvider({
        id: 'experimental-ollama',
        legacyModel: '',
        anonymousUserID,
        mayUseOnDeviceInference: true,
    })
}
