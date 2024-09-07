import * as vscode from 'vscode'
import type { ContextRetriever } from '../types'
import type { BfgRetriever } from './retrievers/bfg/bfg-retriever'
import { JaccardSimilarityRetriever } from './retrievers/jaccard-similarity/jaccard-similarity-retriever'
import { LspLightRetriever } from './retrievers/lsp-light/lsp-light-retriever'
import { RecentCopyRetriever } from './retrievers/recent-copy/recent-copy'
import { RecentEditsRetriever } from './retrievers/recent-edits/recent-edits-retriever'
import { loadTscRetriever } from './retrievers/tsc/load-tsc-retriever'

export type ContextStrategy =
    | 'lsp-light'
    | 'bfg'
    | 'bfg-mixed'
    | 'jaccard-similarity'
    | 'new-jaccard-similarity'
    | 'tsc'
    | 'tsc-mixed'
    | 'none'
    | 'recent-edits'
    | 'recent-edits-1m'
    | 'recent-edits-5m'
    | 'recent-edits-mixed'
    | 'recent-copy'

export interface ContextStrategyFactory extends vscode.Disposable {
    getStrategy(document: vscode.TextDocument): { name: ContextStrategy; retrievers: ContextRetriever[] }
}

export class DefaultContextStrategyFactory implements ContextStrategyFactory {
    private disposables: vscode.Disposable[] = []

    private localRetriever: ContextRetriever | undefined
    private graphRetriever: ContextRetriever | undefined

    constructor(
        private contextStrategy: ContextStrategy,
        createBfgRetriever?: () => BfgRetriever
    ) {
        switch (contextStrategy) {
            case 'none':
                break
            case 'recent-edits':
                this.localRetriever = new RecentEditsRetriever(60 * 1000)
                this.disposables.push(this.localRetriever)
                break
            case 'recent-edits-1m':
                this.localRetriever = new RecentEditsRetriever(60 * 1000)
                this.disposables.push(this.localRetriever)
                break
            case 'recent-edits-5m':
                this.localRetriever = new RecentEditsRetriever(60 * 5 * 1000)
                this.disposables.push(this.localRetriever)
                break
            case 'recent-edits-mixed':
                this.localRetriever = new RecentEditsRetriever(60 * 1000)
                this.graphRetriever = new JaccardSimilarityRetriever()
                this.disposables.push(this.localRetriever)
                this.disposables.push(this.graphRetriever)
                break
            case 'tsc-mixed':
                this.localRetriever = new JaccardSimilarityRetriever()
                this.disposables.push(this.localRetriever)
                this.graphRetriever = loadTscRetriever()
                if (this.graphRetriever) this.disposables.push(this.graphRetriever)
                break
            case 'tsc':
                this.graphRetriever = loadTscRetriever()
                if (this.graphRetriever) this.disposables.push(this.graphRetriever)
                break
            case 'bfg-mixed':
            case 'bfg':
                // The bfg strategy uses jaccard similarity as a fallback if no results are found or
                // the language is not supported by BFG
                this.localRetriever = new JaccardSimilarityRetriever()
                this.disposables.push(this.localRetriever)
                if (createBfgRetriever) {
                    this.graphRetriever = createBfgRetriever()
                    this.disposables.push(this.graphRetriever)
                }
                break
            case 'lsp-light':
                this.localRetriever = new JaccardSimilarityRetriever()
                this.graphRetriever = new LspLightRetriever()
                this.disposables.push(this.localRetriever, this.graphRetriever)
                break
            case 'recent-copy':
                this.localRetriever = new RecentCopyRetriever(60 * 1000, 100)
                this.disposables.push(this.localRetriever)
                break
            case 'jaccard-similarity':
                this.localRetriever = new JaccardSimilarityRetriever()
                this.disposables.push(this.localRetriever)
        }
    }

    public getStrategy(document: vscode.TextDocument): {
        name: ContextStrategy
        retrievers: ContextRetriever[]
    } {
        const retrievers: ContextRetriever[] = []

        switch (this.contextStrategy) {
            case 'none': {
                break
            }

            // The lsp-light strategy mixes local and graph based retrievers
            case 'lsp-light': {
                if (this.graphRetriever?.isSupportedForLanguageId(document.languageId)) {
                    retrievers.push(this.graphRetriever)
                }
                if (this.localRetriever) {
                    retrievers.push(this.localRetriever)
                }
                break
            }

            // The bfg strategy exclusively uses bfg strategy when the language is supported
            case 'bfg':
                if (this.graphRetriever?.isSupportedForLanguageId(document.languageId)) {
                    retrievers.push(this.graphRetriever)
                } else if (this.localRetriever) {
                    retrievers.push(this.localRetriever)
                }
                break

            case 'tsc':
            case 'tsc-mixed':
            // The bfg mixed strategy mixes local and graph based retrievers
            case 'bfg-mixed':
                if (this.graphRetriever?.isSupportedForLanguageId(document.languageId)) {
                    retrievers.push(this.graphRetriever)
                }
                if (this.localRetriever) {
                    retrievers.push(this.localRetriever)
                }
                break

            // The jaccard similarity strategies only uses the local retriever
            case 'jaccard-similarity':
            case 'recent-edits':
            case 'recent-edits-1m':
            case 'recent-edits-5m':
            case 'recent-copy': {
                if (this.localRetriever) {
                    retrievers.push(this.localRetriever)
                }
                break
            }
            case 'recent-edits-mixed': {
                if (this.localRetriever) {
                    retrievers.push(this.localRetriever)
                }
                if (this.graphRetriever?.isSupportedForLanguageId(document.languageId)) {
                    retrievers.push(this.graphRetriever)
                }
                break
            }
        }
        return { name: this.contextStrategy, retrievers }
    }

    public dispose(): void {
        vscode.Disposable.from(...this.disposables).dispose()
    }
}
