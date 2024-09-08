import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FeatureFlagProvider } from '@sourcegraph/cody-shared'
import { FeatureFlag, featureFlagProvider } from '@sourcegraph/cody-shared'
import { getArtificialDelay, lowPerformanceLanguageIds, resetArtificialDelay } from './artificial-delay'
const featureFlags = {
    user: true,
}

describe('await getArtificialDelay', () => {
    const enabledFeatureFlags = new Set<FeatureFlag>()
    let originalFeatureFlagProviderInstance: FeatureFlagProvider | null

    beforeEach(() => {
        vi.useFakeTimers()
        originalFeatureFlagProviderInstance = featureFlagProvider.instance
        enabledFeatureFlags.clear()
        featureFlagProvider.instance = {
            evaluateFeatureFlag: (flag: FeatureFlag) => Promise.resolve(enabledFeatureFlags.has(flag)),
            refresh: () => {},
            getFromCache: (flagName: FeatureFlag) => {
                // raise errors 
                throw new Error('Unreachable code: getFromCache should not be called here unless it is called from the mocked out evaluateFeatureFlag')
                return false
            }
        } as FeatureFlagProvider
    })

    afterEach(() => {
        featureFlagProvider.instance = originalFeatureFlagProviderInstance
        vi.restoreAllMocks()
        resetArtificialDelay()
    })

    it('returns no artificial delay when CodyAutocompleteTracing feature flag is enabled', async () => {
        const uri = 'file://foo/bar/test.css'
        enabledFeatureFlags.add(FeatureFlag.CodyDisableArtificialDelay)

        // css is a low performance language
        const languageId = 'css'
        expect(lowPerformanceLanguageIds.has(languageId)).toBe(true)

        // expect no artificial delay when feature flag is enabled
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(0)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(0)
    })

    it('returns gradually increasing latency up to max for CSS when suggestions are rejected', async () => {
        const uri = 'file://foo/bar/test.css'

        // css is a low performance language
        const languageId = 'css'
        expect(lowPerformanceLanguageIds.has(languageId)).toBe(true)

        // start with default high latency for low performance lang with default user latency added
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1000)
        // start at default, but gradually increasing latency after 5 rejected suggestions
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1050)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1100)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1150)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1200)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1250)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1300)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1350)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1400)
        // max latency at 1400
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1400)
        // after the suggestion was accepted, user latency resets to 0, using baseline only
        resetArtificialDelay()
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1000)
        resetArtificialDelay()
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1000)
        // gradually increasing latency after 5 rejected suggestions
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1050)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1100)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1150)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1200)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1250)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1300)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1350)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1400)
        // Latency will not reset before 5 minutes
        vi.advanceTimersByTime(3 * 60 * 1000)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1400)
        // Latency will be reset after 5 minutes
        vi.advanceTimersByTime(5 * 60 * 1000)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1000)
        // reset latency on accepted suggestion
        resetArtificialDelay()
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1000)
    })

    it('returns increasing latency after rejecting suggestions', async () => {
        const uri = 'file://foo/bar/test.ts'

        // Confirm typescript is not a low performance language
        const languageId = 'typescript'
        expect(lowPerformanceLanguageIds.has(languageId)).toBe(false)

        // start at default, but gradually increasing latency after 5 rejected suggestions
        expect(await getArtificialDelay(featureFlags, uri, languageId, 'arguments')).toBe(0)
        expect(await getArtificialDelay(featureFlags, uri, languageId, 'function.body')).toBe(0)
        // baseline latency increased to 1000 due to comment node type
        expect(await getArtificialDelay(featureFlags, uri, languageId, 'comment')).toBe(1000)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(0)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(0)
        // gradually increasing latency after 5 rejected suggestions
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(50)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(100)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(150)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(200)
        // after the suggestion was accepted, user latency resets to 0, using baseline only
        resetArtificialDelay()
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(0)
    })

    it('returns default latency for CSS after accepting suggestion and resets after 5 minutes', async () => {
        const uri = 'file://foo/bar/test.css'

        // css is a low performance language
        const languageId = 'css'
        expect(lowPerformanceLanguageIds.has(languageId)).toBe(true)

        // start with default baseline latency for low performance lang
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1000)
        // reset to starting point on every accepted suggestion
        resetArtificialDelay()
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1000)
        resetArtificialDelay()
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1000)
        // Latency will not reset before 5 minutes
        vi.advanceTimersByTime(3 * 60 * 1000)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1050)
        // Latency will be reset after 5 minutes
        vi.advanceTimersByTime(5 * 60 * 1000)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1000)
    })

    it('returns increasing latency up to max after rejecting multiple suggestions, resets after file change and accept', async () => {
        const uri = 'file://foo/bar/test.ts'
        const languageId = 'typescript'
        expect(lowPerformanceLanguageIds.has(languageId)).toBe(false)

        // reject the first 5 suggestions, and confirm latency remains unchanged
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(0)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(0)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(0)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(0)
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(0)
        // latency should start increasing after 5 rejections, but max at 1400
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(50)
        // line is a comment, so latency should be increased where:
        // base is 1000 due to line is a comment, and user latency is 400 as this is the 7th rejection
        expect(await getArtificialDelay(featureFlags, uri, languageId, 'comment')).toBe(1100)
        for (let i = 150; i <= 1400; i += 50) {
            expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(i)
        }
        // max at 1400 after multiple rejection
        expect(await getArtificialDelay(featureFlags, uri, languageId)).toBe(1400)

        // reset latency on file change to default
        const newUri = 'foo/test.ts'
        // latency should start increasing again after 5 rejections
        expect(await getArtificialDelay(featureFlags, newUri, languageId)).toBe(0)
        expect(await getArtificialDelay(featureFlags, newUri, languageId)).toBe(0)
        // line is a comment, so latency should be increased
        expect(await getArtificialDelay(featureFlags, newUri, languageId, 'comment')).toBe(1000)
        expect(await getArtificialDelay(featureFlags, newUri, languageId)).toBe(0)
        expect(await getArtificialDelay(featureFlags, newUri, languageId)).toBe(0)
        // Latency will not reset before 5 minutes
        vi.advanceTimersByTime(3 * 60 * 1000)
        expect(await getArtificialDelay(featureFlags, newUri, languageId)).toBe(50)
        // reset latency on accepted suggestion
        resetArtificialDelay()
        expect(await getArtificialDelay(featureFlags, newUri, languageId)).toBe(0)
    })

    it('returns default latency for low performance language only when only language flag is enabled', async () => {
        const uri = 'file://foo/bar/test.css'

        const featureFlagsLangOnly = {
            user: false,
        }

        // css is a low performance language
        const lowPerformLanguageId = 'css'
        expect(lowPerformanceLanguageIds.has(lowPerformLanguageId)).toBe(true)

        // go is not a low performance language
        const languageId = 'go'
        const goUri = 'foo/bar/test.go'
        expect(lowPerformanceLanguageIds.has(languageId)).toBe(false)

        // latency should only change based on language id when only the language flag is enabled
        expect(await getArtificialDelay(featureFlagsLangOnly, uri, lowPerformLanguageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlagsLangOnly, uri, lowPerformLanguageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlagsLangOnly, uri, lowPerformLanguageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlagsLangOnly, uri, lowPerformLanguageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlagsLangOnly, uri, lowPerformLanguageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlagsLangOnly, uri, lowPerformLanguageId)).toBe(1000)
        // latency back to 0 when language is no longer low-performance
        expect(await getArtificialDelay(featureFlagsLangOnly, goUri, languageId)).toBe(0)
    })

    it('returns latency based on language only when user flag is disabled', async () => {
        const uri = 'file://foo/bar/test.css'

        // css is a low performance language
        const languageId = 'css'
        expect(lowPerformanceLanguageIds.has(languageId)).toBe(true)

        const featureFlagsNoUser = {
            user: false,
        }

        // latency starts with language latency
        expect(await getArtificialDelay(featureFlagsNoUser, uri, languageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlagsNoUser, uri, languageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlagsNoUser, uri, languageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlagsNoUser, uri, languageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlagsNoUser, uri, languageId)).toBe(1000)
        // latency should remains unchanged after 5 rejections
        expect(await getArtificialDelay(featureFlagsNoUser, uri, languageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlagsNoUser, uri, languageId)).toBe(1000)
        expect(await getArtificialDelay(featureFlagsNoUser, uri, languageId)).toBe(1000)

        // switch to a non-low-performance language - go is not a low performance language
        const goLanguageId = 'go'
        const goUri = 'foo/bar/test.go'
        expect(lowPerformanceLanguageIds.has(goLanguageId)).toBe(false)
        // reset to provider latency because language latency is ignored for non-low-performance languages
        expect(await getArtificialDelay(featureFlagsNoUser, goUri, goLanguageId)).toBe(0)
    })
})
