import { z } from 'zod'
import { event } from './util'

export const events = [
    event(
        'cody.at-mention',
        'selected',
        z
            .object({
                context: z.string().optional(), // maybe refine to z.enum(["file", "symbol", "remote repsitory", "web urls", "current repository", "current file"])
            })
            .strict()
    ),
    event('cody.at-mention', 'executed', z.object({})),
    event('cody.at-mention.file', 'executed', z.object({})),
]
