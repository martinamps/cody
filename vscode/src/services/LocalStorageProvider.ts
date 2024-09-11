import _ from 'lodash'
import * as uuid from 'uuid'
import type { Memento } from 'vscode'

import {
    type AccountKeyedChatHistory,
    type AuthStatus,
    type AuthenticatedAuthStatus,
    type ChatHistoryKey,
    type ClientConfigurationWithAccessToken,
    type ClientState,
    type UserLocalHistory,
    distinctUntilChanged,
    fromVSCodeEvent,
    startWith,
} from '@sourcegraph/cody-shared'

import { type Observable, map } from 'observable-fns'
import { isSourcegraphToken } from '../chat/protocol'
import { EventEmitter } from '../testutils/mocks'

export type ChatLocation = 'editor' | 'sidebar'

class LocalStorage {
    // Bump this on storage changes so we don't handle incorrectly formatted data
    protected readonly KEY_LOCAL_HISTORY = 'cody-local-chatHistory-v2'
    protected readonly KEY_CONFIG = 'cody-config'
    protected readonly KEY_LOCAL_MINION_HISTORY = 'cody-local-minionHistory-v0'
    public readonly ANONYMOUS_USER_ID_KEY = 'sourcegraphAnonymousUid'
    public readonly LAST_USED_ENDPOINT = 'SOURCEGRAPH_CODY_ENDPOINT'
    protected readonly CODY_ENDPOINT_HISTORY = 'SOURCEGRAPH_CODY_ENDPOINT_HISTORY'
    protected readonly CODY_ENROLLMENT_HISTORY = 'SOURCEGRAPH_CODY_ENROLLMENTS'
    protected readonly LAST_USED_CHAT_MODALITY = 'cody-last-used-chat-modality'

    /**
     * Should be set on extension activation via `localStorage.setStorage(context.globalState)`
     * Done to avoid passing the local storage around as a parameter and instead
     * access it as a singleton via the module import.
     */
    private _storage: Memento | null = null

    private get storage(): Memento {
        if (!this._storage) {
            throw new Error('LocalStorage not initialized')
        }

        return this._storage
    }

    public setStorage(storage: Memento): void {
        this._storage = storage
    }

    public getClientState(): ClientState {
        return {
            lastUsedEndpoint: this.getEndpoint(),
            anonymousUserID: this.anonymousUserID(),
            lastUsedChatModality: this.getLastUsedChatModality(),
        }
    }

    private onChange = new EventEmitter<void>()
    public get clientStateChanges(): Observable<ClientState> {
        return fromVSCodeEvent(this.onChange.event).pipe(
            startWith(undefined),
            map(() => this.getClientState()),
            distinctUntilChanged()
        )
    }

    public getEndpoint(): string | null {
        const endpoint = this.storage.get<string | null>(this.LAST_USED_ENDPOINT, null)
        // Clear last used endpoint if it is a Sourcegraph token
        if (endpoint && isSourcegraphToken(endpoint)) {
            this.deleteEndpoint()
            return null
        }
        return endpoint
    }

    public async saveEndpoint(endpoint: string): Promise<void> {
        if (!endpoint) {
            return
        }
        try {
            // Do not save sourcegraph tokens as the last used endpoint
            if (isSourcegraphToken(endpoint)) {
                return
            }

            const uri = new URL(endpoint).href
            await this.set(this.LAST_USED_ENDPOINT, uri)
            await this.addEndpointHistory(uri)
        } catch (error) {
            console.error(error)
        }
    }

    public async deleteEndpoint(): Promise<void> {
        await this.set(this.LAST_USED_ENDPOINT, null)
    }

    public getEndpointHistory(): string[] | null {
        return this.get<string[] | null>(this.CODY_ENDPOINT_HISTORY)
    }

    private async addEndpointHistory(endpoint: string): Promise<void> {
        // Do not save sourcegraph tokens as endpoint
        if (isSourcegraphToken(endpoint)) {
            return
        }

        const history = this.storage.get<string[] | null>(this.CODY_ENDPOINT_HISTORY, null)
        const historySet = new Set(history)
        historySet.delete(endpoint)
        historySet.add(endpoint)
        await this.set(this.CODY_ENDPOINT_HISTORY, [...historySet])
    }

    public getChatHistory(authStatus: AuthenticatedAuthStatus): UserLocalHistory {
        const history = this.storage.get<AccountKeyedChatHistory | null>(this.KEY_LOCAL_HISTORY, null)
        const accountKey = getKeyForAuthStatus(authStatus)
        return history?.[accountKey] ?? { chat: {} }
    }

    public async setChatHistory(
        authStatus: AuthenticatedAuthStatus,
        history: UserLocalHistory
    ): Promise<void> {
        try {
            const key = getKeyForAuthStatus(authStatus)
            let fullHistory = this.storage.get<AccountKeyedChatHistory | null>(
                this.KEY_LOCAL_HISTORY,
                null
            )

            if (fullHistory) {
                fullHistory[key] = history
            } else {
                fullHistory = {
                    [key]: history,
                }
            }

            // Store the current username as the last used username
            if (authStatus.username) {
                this.storage.update(this.LAST_USED_USERNAME, authStatus.username)
            }
            await this.set(this.KEY_LOCAL_HISTORY, fullHistory)
        } catch (error) {
            console.error(error)
        }
    }

    public async importChatHistory(history: AccountKeyedChatHistory, merge: boolean): Promise<void> {
        if (merge) {
            const fullHistory = this.storage.get<AccountKeyedChatHistory | null>(
                this.KEY_LOCAL_HISTORY,
                null
            )

            _.merge(history, fullHistory)
        }

        await this.storage.update(this.KEY_LOCAL_HISTORY, history)
    }

    public async deleteChatHistory(authStatus: AuthenticatedAuthStatus, chatID: string): Promise<void> {
        const userHistory = this.getChatHistory(authStatus)
        if (userHistory) {
            try {
                delete userHistory.chat[chatID]
                await this.setChatHistory(authStatus, userHistory)
            } catch (error) {
                console.error(error)
            }
        }
    }

    public async setMinionHistory(authStatus: AuthStatus, serializedHistory: string): Promise<void> {
        // TODO(beyang): SECURITY - use authStatus
        await this.set(this.KEY_LOCAL_MINION_HISTORY, serializedHistory)
    }

    public getMinionHistory(authStatus: AuthStatus): string | null {
        // TODO(beyang): SECURITY - use authStatus
        return this.get<string | null>(this.KEY_LOCAL_MINION_HISTORY)
    }

    public async removeChatHistory(authStatus: AuthenticatedAuthStatus): Promise<void> {
        try {
            await this.setChatHistory(authStatus, { chat: {} })
        } catch (error) {
            console.error(error)
        }
    }

    /**
     * Gets the enrollment history for a feature from the storage.
     *
     * Checks if the given feature name exists in the stored enrollment
     * history array.
     *
     * If not, add the feature to the memory, but return false after adding the feature
     * so that the caller can log the first enrollment event.
     */
    public getEnrollmentHistory(featureName: string): boolean {
        const history = this.storage.get<string[]>(this.CODY_ENROLLMENT_HISTORY, [])
        const hasEnrolled = history.includes(featureName)
        // Log the first enrollment event
        if (!hasEnrolled) {
            history.push(featureName)
            this.set(this.CODY_ENROLLMENT_HISTORY, history)
        }
        return hasEnrolled
    }

    /**
     * Return the anonymous user ID stored in local storage or create one if none exists (which
     * occurs on a fresh installation). Callers can check
     * {@link LocalStorage.checkIfCreatedAnonymousUserID} to see if a new anonymous ID was created.
     */
    public anonymousUserID(): string {
        let id = this.storage.get<string>(this.ANONYMOUS_USER_ID_KEY)
        if (!id) {
            this.createdAnonymousUserID = true
            id = uuid.v4()
            this.set(this.ANONYMOUS_USER_ID_KEY, id).catch(error => console.error(error))
        }
        return id
    }

    private createdAnonymousUserID = false
    public checkIfCreatedAnonymousUserID(): boolean {
        if (this.createdAnonymousUserID) {
            this.createdAnonymousUserID = false
            return true
        }
        return false
    }

    public async setConfig(config: ClientConfigurationWithAccessToken): Promise<void> {
        return this.set(this.KEY_CONFIG, config)
    }

    public getConfig(): ClientConfigurationWithAccessToken | null {
        return this.get(this.KEY_CONFIG)
    }

    public setLastUsedChatModality(modality: 'sidebar' | 'editor'): void {
        this.set(this.LAST_USED_CHAT_MODALITY, modality)
    }

    public getLastUsedChatModality(): 'sidebar' | 'editor' {
        return this.get(this.LAST_USED_CHAT_MODALITY) ?? 'sidebar'
    }

    public get<T>(key: string): T | null {
        return this.storage.get(key, null)
    }

    public async set<T>(key: string, value: T): Promise<void> {
        try {
            await this.storage.update(key, value)
            this.onChange.fire()
        } catch (error) {
            console.error(error)
        }
    }

    public async delete(key: string): Promise<void> {
        await this.storage.update(key, undefined)
        this.onChange.fire()
    }
}

/**
 * Singleton instance of the local storage provider.
 * The underlying storage is set on extension activation via `localStorage.setStorage(context.globalState)`.
 */
export const localStorage = new LocalStorage()

function getKeyForAuthStatus(authStatus: AuthenticatedAuthStatus): ChatHistoryKey {
    return `${authStatus.endpoint}-${authStatus.username}`
}
