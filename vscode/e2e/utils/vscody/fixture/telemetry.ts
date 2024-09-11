import { test as _test } from '@playwright/test'
import 'node:http'
import 'node:https'
import jsonStableStringify from 'fast-json-stable-stringify'
import { ulid } from 'ulidx'
import type { TestContext, WorkerContext } from '.'
import { MITM_PROXY_SERVICE_NAME_HEADER } from '../constants'
import { telemetryEventSchema } from '../uix/telemetry/events'
import { getFirstOrValue } from './util'

export interface RecordedTelemetryEvent {
    id: string
    timestamp: Date
    proxyName: string
    event: ReturnType<typeof telemetryEventSchema.safeParse> & { fail?: any }
}
export interface TelemetryRecorder {
    readonly all: RecordedTelemetryEvent[]
}

export const telemetryFixture = _test.extend<TestContext, WorkerContext>({
    telemetryRecorder: [
        async ({ validOptions, polly }, use, testInfo) => {
            const recorder: TelemetryRecorder = {
                all: [],
            }

            polly.server
                .any()
                .filter(req => {
                    return (
                        !!getFirstOrValue(req.getHeader(MITM_PROXY_SERVICE_NAME_HEADER))?.startsWith(
                            'sourcegraph'
                        ) &&
                        req.pathname.startsWith('/.api/graphql') &&
                        'RecordTelemetryEvents' in req.query
                    )
                })
                .intercept((req, res) => {
                    const now = new Date()
                    const body = req.jsonBody()
                    res.status(200).json({
                        data: { telemetry: { recordEvents: { alwaysNil: null } } },
                    })
                    const rawEvents = body?.variables?.events as any[]
                    //todo: allow automatic failure of events
                    for (const event of rawEvents) {
                        const parsed = telemetryEventSchema.safeParse(
                            Object.assign(event, { signature: `${event?.feature}/${event?.action}` })
                        )
                        recorder.all.push({
                            id: ulid(),
                            timestamp: now,
                            proxyName: getFirstOrValue(req.getHeader(MITM_PROXY_SERVICE_NAME_HEADER))!,
                            event: parsed.success ? parsed : { ...parsed, fail: event },
                        })
                    }
                })

            await use(recorder)

            await testInfo.attach('telemetryEvents.json', {
                body: JSON.stringify(JSON.parse(jsonStableStringify(recorder.all)), null, 2),
                contentType: 'application/json',
            })

            //todo: add as attachments
        },
        { scope: 'test' },
    ],
})
