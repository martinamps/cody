import {
    AUTH_STATUS_FIXTURE_AUTHED_DOTCOM,
    type ClientConfiguration,
    type CodyLLMSiteConfiguration,
    type GraphQLAPIClientConfig,
    graphqlClient,
    mockAuthStatus,
    toFirstValueGetter,
} from '@sourcegraph/cody-shared'
import { beforeAll, describe, expect, it } from 'vitest'
import { mockLocalStorage } from '../../services/LocalStorageProvider'
import { getVSCodeConfigurationWithAccessToken } from '../../testutils/mocks'

import { createProvider } from './create-provider'

graphqlClient.setConfig({} as unknown as GraphQLAPIClientConfig)
const createProviderFirstValue = toFirstValueGetter(createProvider)

describe('createProvider', () => {
    beforeAll(async () => {
        mockAuthStatus()
        mockLocalStorage()
    })

    describe('local settings', () => {
        it('returns `null` if completions provider is not supported', async () => {
            const provider = await createProviderFirstValue(
                getVSCodeConfigurationWithAccessToken({
                    autocompleteAdvancedProvider:
                        'nasa-ai' as ClientConfiguration['autocompleteAdvancedProvider'],
                })
            )

            expect(provider).toBeNull()
        })

        it('uses configOverwrites if completions provider is not configured', async () => {
            const provider = await createProviderFirstValue(
                getVSCodeConfigurationWithAccessToken({
                    autocompleteAdvancedProvider:
                        null as ClientConfiguration['autocompleteAdvancedProvider'],
                })
            )

            expect(provider?.id).toBe('fireworks')
            expect(provider?.legacyModel).toBe('starcoder-hybrid')
        })

        it('returns "fireworks" provider config and corresponding model if specified', async () => {
            const provider = await createProviderFirstValue(
                getVSCodeConfigurationWithAccessToken({
                    autocompleteAdvancedProvider: 'fireworks',
                    autocompleteAdvancedModel: 'starcoder-7b',
                })
            )
            expect(provider?.id).toBe('fireworks')
            expect(provider?.legacyModel).toBe('starcoder-7b')
        })

        it('returns "fireworks" provider config if specified in settings and default model', async () => {
            const provider = await createProviderFirstValue(
                getVSCodeConfigurationWithAccessToken({ autocompleteAdvancedProvider: 'fireworks' })
            )
            expect(provider?.id).toBe('fireworks')
            expect(provider?.legacyModel).toBe('deepseek-coder-v2-lite-base')
        })

        it('returns "experimental-openaicompatible" provider config and corresponding model if specified', async () => {
            const provider = await createProviderFirstValue(
                getVSCodeConfigurationWithAccessToken({
                    autocompleteAdvancedProvider: 'experimental-openaicompatible',
                    autocompleteAdvancedModel: 'starchat-16b-beta',
                })
            )
            expect(provider?.id).toBe('experimental-openaicompatible')
            expect(provider?.legacyModel).toBe('starchat-16b-beta')
        })

        it('returns "experimental-openaicompatible" provider config if specified in settings and default model', async () => {
            const provider = await createProviderFirstValue(
                getVSCodeConfigurationWithAccessToken({
                    autocompleteAdvancedProvider: 'experimental-openaicompatible',
                })
            )
            expect(provider?.id).toBe('experimental-openaicompatible')
            expect(provider?.legacyModel).toBe('starcoder-hybrid')
        })

        it('returns "unstable-openai" provider config if specified in VSCode settings; model is ignored', async () => {
            const provider = await createProviderFirstValue(
                getVSCodeConfigurationWithAccessToken({
                    autocompleteAdvancedProvider: 'unstable-openai',
                    autocompleteAdvancedModel: 'hello-world',
                })
            )
            expect(provider?.id).toBe('unstable-openai')
            expect(provider?.legacyModel).toBe('gpt-35-turbo')
        })

        it('returns "anthropic" provider config if specified in VSCode settings', async () => {
            const provider = await createProviderFirstValue(
                getVSCodeConfigurationWithAccessToken({
                    autocompleteAdvancedProvider: 'anthropic',
                })
            )
            expect(provider?.id).toBe('anthropic')
            expect(provider?.legacyModel).toBe('anthropic/claude-instant-1.2')
        })

        it('provider specified in VSCode settings takes precedence over the one defined in the site config', async () => {
            mockAuthStatus({
                ...AUTH_STATUS_FIXTURE_AUTHED_DOTCOM,
                configOverwrites: {
                    provider: 'fireworks',
                    completionModel: 'starcoder-hybrid',
                },
            })

            const provider = await createProviderFirstValue(
                getVSCodeConfigurationWithAccessToken({
                    autocompleteAdvancedProvider: 'unstable-openai',
                })
            )
            expect(provider?.id).toBe('unstable-openai')
            expect(provider?.legacyModel).toBe('gpt-35-turbo')
        })
    })

    describe('completions provider and model are defined in the site config and not set in VSCode settings', () => {
        describe('if provider is "sourcegraph"', () => {
            const testCases: {
                configOverwrites: CodyLLMSiteConfiguration
                expected: { provider: string; legacyModel?: string } | null
            }[] = [
                // sourcegraph
                {
                    configOverwrites: { provider: 'sourcegraph', completionModel: 'hello-world' },
                    expected: null,
                },
                {
                    configOverwrites: {
                        provider: 'sourcegraph',
                        completionModel: 'anthropic/claude-instant-1.2',
                    },
                    expected: { provider: 'anthropic', legacyModel: 'anthropic/claude-instant-1.2' },
                },
                {
                    configOverwrites: { provider: 'sourcegraph', completionModel: 'anthropic/' },
                    expected: null,
                },
                {
                    configOverwrites: {
                        provider: 'sourcegraph',
                        completionModel: '/claude-instant-1.2',
                    },
                    expected: null,
                },
                {
                    configOverwrites: {
                        provider: 'sourcegraph',
                        completionModel: 'fireworks/starcoder',
                    },
                    expected: { provider: 'fireworks', legacyModel: 'starcoder' },
                },

                // aws-bedrock
                {
                    configOverwrites: { provider: 'aws-bedrock', completionModel: 'hello-world' },
                    expected: null,
                },
                {
                    configOverwrites: {
                        provider: 'aws-bedrock',
                        completionModel: 'anthropic.claude-instant-1.2',
                    },
                    expected: { provider: 'anthropic', legacyModel: 'anthropic/claude-instant-1.2' },
                },
                {
                    configOverwrites: { provider: 'aws-bedrock', completionModel: 'anthropic.' },
                    expected: null,
                },
                {
                    configOverwrites: {
                        provider: 'aws-bedrock',
                        completionModel: 'anthropic/claude-instant-1.2',
                    },
                    expected: null,
                },

                // open-ai
                {
                    configOverwrites: { provider: 'openai', completionModel: 'gpt-35-turbo-test' },
                    expected: { provider: 'unstable-openai', legacyModel: 'gpt-35-turbo-test' },
                },
                {
                    configOverwrites: { provider: 'openai' },
                    expected: { provider: 'unstable-openai', legacyModel: 'gpt-35-turbo' },
                },

                // azure-openai
                {
                    configOverwrites: { provider: 'azure-openai', completionModel: 'gpt-35-turbo-test' },
                    expected: { provider: 'unstable-openai', legacyModel: '' },
                },
                {
                    configOverwrites: { provider: 'azure-openai' },
                    expected: { provider: 'unstable-openai', legacyModel: 'gpt-35-turbo' },
                },

                // fireworks
                {
                    configOverwrites: { provider: 'fireworks', completionModel: 'starcoder-7b' },
                    expected: { provider: 'fireworks', legacyModel: 'starcoder-7b' },
                },
                {
                    configOverwrites: { provider: 'fireworks' },
                    expected: { provider: 'fireworks', legacyModel: 'deepseek-coder-v2-lite-base' },
                },

                // unknown-provider
                {
                    configOverwrites: {
                        provider: 'unknown-provider',
                        completionModel: 'superdupercoder-7b',
                    },
                    expected: null,
                },

                // provider not defined (backward compat)
                {
                    configOverwrites: { provider: undefined, completionModel: 'superdupercoder-7b' },
                    expected: null,
                },
            ]

            for (const { configOverwrites, expected } of testCases) {
                it(`returns ${JSON.stringify(expected)} when cody LLM config is ${JSON.stringify(
                    configOverwrites
                )}`, async () => {
                    mockAuthStatus({
                        ...AUTH_STATUS_FIXTURE_AUTHED_DOTCOM,
                        configOverwrites,
                    })

                    const provider = await createProviderFirstValue(
                        getVSCodeConfigurationWithAccessToken()
                    )

                    if (expected === null) {
                        expect(provider).toBeNull()
                    } else {
                        expect(provider?.id).toBe(expected.provider)
                        expect(provider?.legacyModel).toBe(expected.legacyModel)
                    }
                })
            }
        })
    })
})
