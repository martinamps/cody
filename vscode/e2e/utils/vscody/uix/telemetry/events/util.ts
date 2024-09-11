import { type ZodDiscriminatedUnion, type ZodObject, z } from 'zod'

// TODO:
/**
 * Validate according to lib rules
 * https://github.com/sourcegraph/telemetry/blob/main/src/validate.ts
 */

const sourceSchema = z.object({ client: z.string(), clientVersion: z.string() })
export function event<
    F extends string = string,
    A extends string = string,
    T extends ZodObject<{}> | ZodDiscriminatedUnion<string, any> = any,
>(feature: F, action: A, parameters?: T) {
    const defaultParameters = z.object({}).default({})
    const schema = z.object({
        signature: z.literal(`${feature}/${action}` as const),
        feature: z.literal(feature),
        action: z.literal(action),
        source: sourceSchema,
        parameters: parameters ?? (defaultParameters as unknown as T),
        timestamp: z.coerce.date(),
    })

    return schema
}

/**
 * convenient function to automatically convert multiple feature actions into
 * events array returns a const array where each action has been converted into
 * an event with a unice id
 */
export function eventsFor<
    Feature extends string = string,
    Action extends string = string,
    Actions extends Record<Action, ZodObject<{}> | ZodDiscriminatedUnion<string, any>> = Record<
        Action,
        any
    >,
>(
    feature: Feature,
    actions: Actions
): Readonly<
    {
        [K in keyof typeof actions]: K extends string
            ? ReturnType<typeof event<Feature, K, (typeof actions)[K]>>
            : never
    }[keyof typeof actions][]
> {
    const events = Object.entries(actions).map(([key, params]) => {
        return event(feature, key, params as any)
    })

    return events as unknown as any
}
