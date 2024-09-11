import { z } from 'zod'

import { events as atMentionEvents } from './atMention'
import { events as extensionEvents } from './extension'

const combinedEvents = [...extensionEvents, ...atMentionEvents] as const
export const telemetryEventSchema = z.discriminatedUnion(
    'signature',
    combinedEvents as TupleFromArray<typeof combinedEvents>
)

export type TelemetryEvent = z.infer<typeof telemetryEventSchema>
export type TelemetryEventSignature = TelemetryEvent['signature']
export type TelemetryEventFeature = TelemetryEvent['feature']
export type TelemetryEventAction<F extends TelemetryEventFeature> = Extract<
    TelemetryEvent,
    { feature: F }
>['action']

type TupleFromArray<T extends ReadonlyArray<any>> = T extends ReadonlyArray<infer U> ? [...T] : never
