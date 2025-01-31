import { type Model, ModelUsage, currentAuthStatusAuthed, modelsService } from '@sourcegraph/cody-shared'

interface ModelInfo {
    provider: string
    legacyModel?: string
    model?: Model
}

export function getModelInfo(): ModelInfo | Error {
    const model = modelsService.instance!.getDefaultModel(ModelUsage.Autocomplete)

    if (model) {
        let provider = model.provider
        if (model.clientSideConfig?.openAICompatible) {
            provider = 'openaicompatible'
        }
        return { provider, legacyModel: model.id, model }
    }

    const { configOverwrites } = currentAuthStatusAuthed()

    if (configOverwrites?.provider) {
        return parseProviderAndModel({
            provider: configOverwrites.provider,
            legacyModel: configOverwrites.completionModel,
        })
    }

    // Fail with error if no `completionModel` is configured.
    return new Error(
        'Failed to get autocomplete model info. Please configure the `completionModel` using site configuration.'
    )
}

const delimiters: Record<string, string> = {
    sourcegraph: '/',
    'aws-bedrock': '.',
}

/**
 * For certain completions providers configured in the Sourcegraph instance site config
 * the model name consists MODEL_PROVIDER and MODEL_NAME separated by a specific delimiter (see {@link delimiters}).
 *
 * This function checks if the given provider has a specific model naming format and:
 *   - if it does, parses the model name and returns the parsed provider and model names;
 *   - if it doesn't, returns the original provider and model names.
 *
 * E.g. for "sourcegraph" provider the completions model name consists of model provider and model name separated by "/".
 * So when received `{ provider: "sourcegraph", model: "anthropic/claude-instant-1" }` the expected output would be `{ provider: "anthropic", model: "claude-instant-1" }`.
 */
function parseProviderAndModel({ provider, legacyModel }: ModelInfo): ModelInfo | Error {
    const delimiter = delimiters[provider]
    if (!delimiter) {
        return { provider, legacyModel: legacyModel }
    }

    if (legacyModel) {
        const index = legacyModel.indexOf(delimiter)
        const parsedProvider = legacyModel.slice(0, index)
        const parsedModel = legacyModel.slice(index + 1)
        if (parsedProvider && parsedModel) {
            return { provider: parsedProvider, legacyModel: parsedModel }
        }
    }

    return new Error(
        (legacyModel
            ? `Failed to parse the model name ${legacyModel}`
            : `Model missing but delimiter ${delimiter} expected`) +
            `for '${provider}' completions provider.`
    )
}
