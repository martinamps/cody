import { type ClientConfiguration, FeatureFlag, featureFlagProvider } from '@sourcegraph/cody-shared'
import { isRunningInsideAgent } from '../jsonrpc/isRunningInsideAgent'
import type { ContextStrategy } from './context/context-strategy'

class CompletionProviderConfig {
    private _config?: ClientConfiguration

    private flagsToResolve = [
        FeatureFlag.CodyAutocompleteUserLatency,
        FeatureFlag.CodyAutocompleteTracing,
        FeatureFlag.CodyAutocompleteContextExtendLanguagePool,
        FeatureFlag.CodyAutocompletePreloadingExperimentBaseFeatureFlag,
        FeatureFlag.CodyAutocompletePreloadingExperimentVariant1,
        FeatureFlag.CodyAutocompletePreloadingExperimentVariant2,
        FeatureFlag.CodyAutocompletePreloadingExperimentVariant3,
        FeatureFlag.CodyAutocompleteContextExperimentBaseFeatureFlag,
        FeatureFlag.CodyAutocompleteContextExperimentVariant1,
        FeatureFlag.CodyAutocompleteContextExperimentVariant2,
        FeatureFlag.CodyAutocompleteContextExperimentVariant3,
        FeatureFlag.CodyAutocompleteContextExperimentVariant4,
        FeatureFlag.CodyAutocompleteContextExperimentControl,
        FeatureFlag.codyAutocompleteDisableArtificialDelay,
    ] as const

    private get config() {
        if (!this._config) {
            throw new Error('CompletionProviderConfig is not initialized')
        }

        return this._config
    }

    /**
     * Should be called before `InlineCompletionItemProvider` instance is created, so that the singleton
     * with resolved values is ready for downstream use.
     */
    public async init(config: ClientConfiguration): Promise<void> {
        this._config = config

        await Promise.all(
            this.flagsToResolve.map(flag => featureFlagProvider.instance!.evaluateFeatureFlag(flag))
        )
    }

    public setConfig(config: ClientConfiguration) {
        this._config = config
    }

    public getPrefetchedFlag(flag: (typeof this.flagsToResolve)[number]): boolean {
        return Boolean(featureFlagProvider.instance!.getFromCache(flag as FeatureFlag))
    }

    public get contextStrategy(): ContextStrategy {
        switch (this.config.autocompleteExperimentalGraphContext as string) {
            case 'lsp-light':
                return 'lsp-light'
            case 'tsc-mixed':
                return 'tsc-mixed'
            case 'tsc':
                return 'tsc'
            case 'bfg':
                return 'bfg'
            case 'bfg-mixed':
                return 'bfg-mixed'
            case 'jaccard-similarity':
                return 'jaccard-similarity'
            case 'new-jaccard-similarity':
                return 'new-jaccard-similarity'
            case 'recent-edits':
                return 'recent-edits'
            case 'recent-edits-1m':
                return 'recent-edits-1m'
            case 'recent-edits-5m':
                return 'recent-edits-5m'
            case 'recent-edits-mixed':
                return 'recent-edits-mixed'
            default:
                return this.experimentBasedContextStrategy()
        }
    }

    public experimentBasedContextStrategy(): ContextStrategy {
        const defaultContextStrategy = 'jaccard-similarity'

        const isContextExperimentFlagEnabled = this.getPrefetchedFlag(
            FeatureFlag.CodyAutocompleteContextExperimentBaseFeatureFlag
        )
        if (isRunningInsideAgent() || !isContextExperimentFlagEnabled) {
            return defaultContextStrategy
        }

        const [variant1, variant2, variant3, variant4, control] = [
            this.getPrefetchedFlag(FeatureFlag.CodyAutocompleteContextExperimentVariant1),
            this.getPrefetchedFlag(FeatureFlag.CodyAutocompleteContextExperimentVariant2),
            this.getPrefetchedFlag(FeatureFlag.CodyAutocompleteContextExperimentVariant3),
            this.getPrefetchedFlag(FeatureFlag.CodyAutocompleteContextExperimentVariant4),
            this.getPrefetchedFlag(FeatureFlag.CodyAutocompleteContextExperimentControl),
        ]
        if (variant1) {
            return 'recent-edits-1m'
        }
        if (variant2) {
            return 'recent-edits-5m'
        }
        if (variant3) {
            return 'recent-edits-mixed'
        }
        if (variant4) {
            return 'none'
        }
        if (control) {
            return defaultContextStrategy
        }
        return defaultContextStrategy
    }

    private getPreloadingExperimentGroup(): 'variant1' | 'variant2' | 'variant3' | 'control' {
        // The desired distribution:
        // - Variant-1 25%
        // - Variant-2 25%
        // - Variant-3 25%
        // - Control group 25%
        //
        // The rollout values to set:
        // - CodyAutocompletePreloadingExperimentBaseFeatureFlag 75%
        // - CodyAutocompleteVariant1 33%
        // - CodyAutocompleteVariant2 100%
        // - CodyAutocompleteVariant3 50%
        if (this.getPrefetchedFlag(FeatureFlag.CodyAutocompletePreloadingExperimentBaseFeatureFlag)) {
            if (this.getPrefetchedFlag(FeatureFlag.CodyAutocompletePreloadingExperimentVariant1)) {
                return 'variant1'
            }

            if (this.getPrefetchedFlag(FeatureFlag.CodyAutocompletePreloadingExperimentVariant2)) {
                if (this.getPrefetchedFlag(FeatureFlag.CodyAutocompletePreloadingExperimentVariant3)) {
                    return 'variant2'
                }
                return 'variant3'
            }
        }

        return 'control'
    }

    public get autocompletePreloadDebounceInterval(): number {
        const localInterval = this.config.autocompleteExperimentalPreloadDebounceInterval

        if (localInterval !== undefined && localInterval > 0) {
            return localInterval
        }

        const preloadingExperimentGroup = this.getPreloadingExperimentGroup()

        switch (preloadingExperimentGroup) {
            case 'variant1':
                return 150
            case 'variant2':
                return 250
            case 'variant3':
                return 350
            default:
                return 0
        }
    }

    public get autocompleteEnableAritificialDelay(): boolean {
        return this.getPrefetchedFlag(FeatureFlag.codyAutocompleteDisableArtificialDelay)
    }
}

/**
 * A singleton store for completion provider configuration values which allows us to
 * avoid propagating every feature flag and config value through completion provider
 * internal calls. It guarantees that `flagsToResolve` are resolved on `CompletionProvider`
 * creation and along with `Configuration`.
 *
 * A subset of relevant config values and feature flags is moved here from the existing
 * params waterfall. Ideally, we rely on this singleton as a source of truth for config values
 * and collapse function calls nested in `InlineCompletionItemProvider.generateCompletions()`.
 */
export const completionProviderConfig = new CompletionProviderConfig()
