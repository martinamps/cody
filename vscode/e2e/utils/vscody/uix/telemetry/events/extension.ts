import { z } from 'zod'
import { event } from './util'

export const events = [
    event(
        'cody.extension',
        'installed',
        z.discriminatedUnion('version', [
            z.object({
                version: z.literal(0),
                metadata: z.array(
                    z.discriminatedUnion('key', [
                        z.object({ key: z.literal('contextSelection'), value: z.number().int() }),
                    ])
                ),
            }),
        ])
    ),
] as const
