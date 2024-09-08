import * as vscode from 'vscode'

import {
    type AuthCredentials,
    type AuthStatus,
    ClientConfigSingleton,
    CodyIDE,
    DOTCOM_URL,
    SourcegraphGraphQLAPIClient,
    type Unsubscribable,
    currentResolvedConfig,
    dependentAbortController,
    isAbortError,
    isDotCom,
    isError,
    isNetworkLikeError,
    logError,
    resolvedConfig,
    setAuthStatusObservable,
    telemetryRecorder,
} from '@sourcegraph/cody-shared'
import { Subject } from 'observable-fns'
import { formatURL } from '../auth/auth'
import { newAuthStatus } from '../chat/utils'
import { logDebug } from '../log'
import { syncModels } from '../models/sync'
import { maybeStartInteractiveTutorial } from '../tutorial/helpers'
import { localStorage } from './LocalStorageProvider'
import { secretStorage } from './SecretStorageProvider'

const HAS_AUTHENTICATED_BEFORE_KEY = 'has-authenticated-before'

export class AuthProvider implements vscode.Disposable {
    private status = new Subject<AuthStatus>()
    private configSubscription: Unsubscribable

    constructor() {
        setAuthStatusObservable(this.status)

        // TODO!(sqs): figure out what endpointHistory is used for here
        // this.loadEndpointHistory()

        let firstAuth = true
        this.configSubscription = resolvedConfig.subscribe(async ({ clientState }) => {
            if (!firstAuth) {
                return
            }
            firstAuth = false

            const lastEndpoint = clientState.lastUsedEndpoint ?? DOTCOM_URL.toString()

            // Attempt to auth with the last-used credentials.
            const token = await secretStorage.get(lastEndpoint || '')
            logDebug(
                'AuthProvider:init:lastEndpoint',
                token?.trim() ? 'Token recovered from secretStorage' : 'No token found in secretStorage',
                lastEndpoint
            )

            await this.auth({
                endpoint: lastEndpoint,
                token: token || null,
                isExtensionStartup: true,
            }).catch(error => logError('AuthProvider:init:failed', lastEndpoint, { verbose: error }))
        })
    }

    public dispose(): void {
        this.configSubscription.unsubscribe()
    }

    // Create Auth Status
    private async makeAuthStatus(
        credentials: AuthCredentials,
        signal: AbortSignal
    ): Promise<AuthStatus> {
        const endpoint = credentials.serverEndpoint
        const token = credentials.accessToken

        const { configuration } = await currentResolvedConfig()
        const isCodyWeb = configuration.agentIDE === CodyIDE.Web

        // Cody Web can work without access token since authorization flow
        // relies on cookie authentication
        if (isCodyWeb) {
            if (!endpoint) {
                return { authenticated: false, endpoint }
            }
        } else {
            if (!token || !endpoint) {
                return { authenticated: false, endpoint }
            }
        }

        // Check if credentials are valid and if Cody is enabled for the credentials and endpoint.
        //
        // TODO!(sqs): pass customHeaders into here bc they are needed for auth
        const client = SourcegraphGraphQLAPIClient.withStaticConfig({ auth: credentials })

        // Version is for frontend to check if Cody is not enabled due to unsupported version when siteHasCodyEnabled is false
        const [{ enabled: siteHasCodyEnabled, version: siteVersion }, codyLLMConfiguration, userInfo] =
            await Promise.all([
                client.isCodyEnabled(signal),
                client.getCodyLLMConfiguration(signal),
                client.getCurrentUserInfo(signal),
            ])
        signal.throwIfAborted()

        logDebug('CodyLLMConfiguration', JSON.stringify(codyLLMConfiguration))
        // check first if it's a network error
        if (isError(userInfo) && isNetworkLikeError(userInfo)) {
            return { authenticated: false, showNetworkError: true, endpoint }
        }
        if (!userInfo || isError(userInfo)) {
            return { authenticated: false, endpoint, showInvalidAccessTokenError: true }
        }
        if (!siteHasCodyEnabled) {
            vscode.window.showErrorMessage(
                `Cody is not enabled on this Sourcegraph instance (${endpoint}). Ask a site administrator to enable it.`
            )
            return { authenticated: false, endpoint }
        }

        const configOverwrites = isError(codyLLMConfiguration) ? undefined : codyLLMConfiguration

        if (!isDotCom(endpoint)) {
            return newAuthStatus({
                ...userInfo,
                endpoint,
                siteVersion,
                configOverwrites,
                authenticated: true,
                hasVerifiedEmail: false,
                userCanUpgrade: false,
            })
        }

        // Configure AuthStatus for DotCom users

        const proStatus = await client.getCurrentUserCodySubscription()
        // Pro user without the pending status is the valid pro users
        const isActiveProUser =
            proStatus !== null &&
            'plan' in proStatus &&
            proStatus.plan === 'PRO' &&
            proStatus.status !== 'PENDING'

        return newAuthStatus({
            ...userInfo,
            authenticated: true,
            endpoint,
            siteVersion,
            configOverwrites,
            userCanUpgrade: !isActiveProUser,
        })
    }

    private inflightAuth: AbortController | null = null

    // It processes the authentication steps and stores the login info before sharing the auth status with chatview
    public async auth({
        endpoint,
        token,
        customHeaders,
        isExtensionStartup = false,
        signal,
    }: {
        endpoint: string
        token: string | null
        customHeaders?: Record<string, string> | null
        isExtensionStartup?: boolean
        signal?: AbortSignal
    }): Promise<AuthStatus> {
        if (this.inflightAuth) {
            this.inflightAuth.abort()
        }
        const abortController = dependentAbortController(signal)
        this.inflightAuth = abortController

        const formattedEndpoint = formatURL(endpoint)
        if (!formattedEndpoint) {
            throw new Error(`invalid endpoint URL: ${JSON.stringify(endpoint)}`)
        }

        const credentials: AuthCredentials = {
            serverEndpoint: formattedEndpoint,
            accessToken: token,
        }

        try {
            const authStatus = await this.makeAuthStatus(credentials, abortController.signal)
            abortController.signal.throwIfAborted()

            await this.storeAuthInfo(credentials)
            abortController.signal.throwIfAborted()

            await vscode.commands.executeCommand(
                'setContext',
                'cody.activated',
                authStatus.authenticated
            )
            abortController.signal.throwIfAborted()

            await this.updateAuthStatus(authStatus, abortController.signal)
            abortController.signal.throwIfAborted()

            // If the extension is authenticated on startup, it can't be a user's first
            // ever authentication. We store this to prevent logging first-ever events
            // for already existing users.
            if (isExtensionStartup && authStatus.authenticated) {
                await this.setHasAuthenticatedBefore()
                abortController.signal.throwIfAborted()
            } else if (authStatus.authenticated) {
                this.handleFirstEverAuthentication()
            }

            return authStatus
        } catch (error) {
            if (isAbortError(error)) {
                throw error
            }

            logDebug('AuthProvider:auth', 'failed', error)
            // TODO!(sqs): handle the kind of error this is
            return {
                endpoint,
                authenticated: false,
                showInvalidAccessTokenError: true,
            }
        } finally {
            if (this.inflightAuth === abortController) {
                this.inflightAuth = null
            }
        }
    }

    // Set auth status in case of reload
    public async reloadAuthStatus(): Promise<AuthStatus> {
        await vscode.commands.executeCommand('setContext', 'cody.activated', false)

        const { configuration, auth } = await currentResolvedConfig()
        return await this.auth({
            endpoint: auth.serverEndpoint,
            token: auth.accessToken,
            customHeaders: configuration.customHeaders,
        })
    }

    private async updateAuthStatus(authStatus: AuthStatus, signal: AbortSignal): Promise<void> {
        try {
            await ClientConfigSingleton.getInstance().setAuthStatus(authStatus, signal)
            await syncModels(authStatus)
        } catch (error) {
            if (!isAbortError(error)) {
                logDebug('AuthProvider', 'updateAuthStatus error', error)
            }
        } finally {
            if (!signal.aborted) {
                this.status.next(authStatus)
                let eventValue: 'disconnected' | 'connected' | 'failed'
                if (
                    !authStatus.authenticated &&
                    (authStatus.showNetworkError || authStatus.showInvalidAccessTokenError)
                ) {
                    eventValue = 'failed'
                } else if (authStatus.authenticated) {
                    eventValue = 'connected'
                } else {
                    eventValue = 'disconnected'
                }
                telemetryRecorder.recordEvent('cody.auth', eventValue, {
                    billingMetadata: {
                        product: 'cody',
                        category: 'billable',
                    },
                })
            }
        }
    }

    // Store endpoint in local storage, token in secret storage, and update endpoint history.
    private async storeAuthInfo(credentials: AuthCredentials): Promise<void> {
        if (!credentials.serverEndpoint) {
            return
        }
        await localStorage.saveEndpoint(credentials.serverEndpoint)
        if (credentials.accessToken) {
            await secretStorage.storeToken(credentials.serverEndpoint, credentials.accessToken)
        }
    }

    public setAuthPendingToEndpoint(endpoint: string): void {
        this.status.next({ authenticated: false, endpoint })
    }

    // Logs a telemetry event if the user has never authenticated to Sourcegraph.
    private handleFirstEverAuthentication(): void {
        if (localStorage.get(HAS_AUTHENTICATED_BEFORE_KEY)) {
            // User has authenticated before, noop
            return
        }
        telemetryRecorder.recordEvent('cody.auth.login', 'firstEver', {
            billingMetadata: {
                product: 'cody',
                category: 'billable',
            },
        })
        this.setHasAuthenticatedBefore()
        void maybeStartInteractiveTutorial()
    }

    private setHasAuthenticatedBefore() {
        return localStorage.set(HAS_AUTHENTICATED_BEFORE_KEY, 'true')
    }
}

export const authProvider = new AuthProvider()
