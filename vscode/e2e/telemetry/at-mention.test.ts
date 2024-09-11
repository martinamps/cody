import { expect } from '@playwright/test'
import { fixture as test, uix } from '../utils/vscody'
import { MITM_AUTH_TOKEN_PLACEHOLDER } from '../utils/vscody/constants'
import { modifySettings } from '../utils/vscody/uix/workspace'

test.describe('cody.at-mention', () => {
    // test.skip(true, "This isn't an actual working test. Just here to show what the API looks like")
    test.use({
        templateWorkspaceDir: 'test/fixtures/legacy-polyglot-template',
    })
    test('`/execute` should not fire pre-maturely', async ({
        page,
        mitmProxy,
        vscodeUI,
        polly,
        workspaceDir,
        telemetryRecorder,
    }, testInfo) => {
        // Behavior is described here:
        // https://linear.app/sourcegraph/issue/CODY-3405/fix-mention-telemetry

        const session = uix.vscode.Session.pending({ page, vscodeUI, workspaceDir })
        const cody = uix.cody.Extension.with({ page, workspaceDir })

        await test.step('setup', async () => {
            await modifySettings(
                s => ({
                    ...s,
                    'cody.accessToken': MITM_AUTH_TOKEN_PLACEHOLDER,
                    'cody.serverEndpoint': mitmProxy.sourcegraph.dotcom.endpoint,
                }),
                { workspaceDir }
            )
            await session.start()
            await cody.waitUntilReady()
            await session.editor.openFile({
                workspaceFile: 'buzz.ts',
                selection: { start: { line: 3 }, end: { line: 5 } },
            })
        })

        await session.runCommand('cody.chat.newEditorPanel')
        const [chat] = await uix.cody.WebView.all(session, { atLeast: 1 })
        await chat.waitUntilReady()

        //TODO: make a nice UIX class for this
        const chatInput = chat.content.getByRole('textbox', { name: 'Chat message' })
        await expect(chatInput).toBeVisible()
        const telemetry = uix.telemetry.TelemetrySnapshot.fromNow({
            telemetryRecorder,
        })
        await chatInput.fill('@')

        const atMenu = await chat.content.locator('[data-at-mention-menu]')
        await expect(atMenu).toBeVisible()
        await atMenu.locator('[data-value="provider:file"]').click()

        await expect(atMenu.locator('[data-value^="[\\"file\\""]').first()).toBeVisible()
        // we need to wait for some telemetry events to come in
        const selectTelemetry = telemetry.snap()

        expect(
            selectTelemetry.filter({ matching: { action: 'executed' } }),
            'Execution events should not have fired'
        ).toEqual([])
        const [mentionEvent, fileEvent, ...otherEvents] = selectTelemetry.filter({
            matching: { feature: 'cody.at-mention', action: 'selected' },
        })
        expect(otherEvents).toEqual([])
        expect(mentionEvent?.event?.data?.parameters).toEqual({})
        expect(fileEvent?.event?.data?.parameters).toEqual({
            context: 'file',
        })

        // we now ensure that the event did fire if we do select a file
        await atMenu.locator('[data-value^="[\\"file\\""]').first().click()
        await expect(atMenu).not.toBeVisible()
        await chatInput.press('Enter')

        uix.wait({ page, testInfo })

        //@ts-ignore
        const executeTelemetry = telemetry.snap(selectTelemetry)

        // finally we check some global conditions

        telemetry.stop()
        expect(telemetry.filter({ valid: false }), 'All events must be valid').toEqual([])

        // const [signInView, ...otherWebviews] = await uix.cody.WebView.all({ page }, { atLeast: 1 })

        // expect(signInView).toBeTruthy()
        // expect(otherWebviews).toHaveLength(0)

        // await signInView.waitUntilReady()
        // await expect(signInView.wrapper).toBeVisible()

        // await expect(
        //     signInView.content.getByRole('button', { name: 'Sign In to Your Enterprise Instance' })
        // ).toBeVisible()
    })
})
