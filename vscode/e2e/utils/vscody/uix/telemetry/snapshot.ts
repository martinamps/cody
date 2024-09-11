import { isArray } from 'lodash'
import type { UIXContextFnContext } from '..'
import type { RecordedTelemetryEvent } from '../../fixture/telemetry'
import type { TelemetryEventAction, TelemetryEventFeature } from './events'

type Options = Pick<UIXContextFnContext, 'telemetryRecorder'>
type Ctx = {
    start?: number
    end?: number
} & Options
export class TelemetrySnapshot {
    private constructor(private ctx: Ctx) {}

    static fromNow(opts: Options) {
        return new TelemetrySnapshot({ ...opts, start: opts.telemetryRecorder.all.length })
    }

    static untilNow(opts: Options) {
        return new TelemetrySnapshot({ ...opts, start: 0, end: opts.telemetryRecorder.all.length })
    }

    /**
     * Returns a new stopped snapshot but keeps the original one running. If a
     * previous snapshot is passed in the new snapshot starts after the last one
     * was taken.
     */
    snap(previous?: TelemetrySnapshot): TelemetrySnapshot {
        return new TelemetrySnapshot({
            ...this.ctx,
            start: previous?.ctx.end ?? this.ctx.start,
            end: this.ctx.telemetryRecorder.all.length,
        })
    }

    /**
     * Freezes this telemetry snapshot and returns
     */
    stop(): TelemetrySnapshot {
        this.ctx.end = this.ctx.end ?? this.ctx.telemetryRecorder.all.length
        return this
    }

    get events() {
        return this.ctx.telemetryRecorder.all.slice(this.ctx.start ?? 0, this.ctx.end ?? undefined)
    }

    filter({
        valid,
        matching,
        notMatching,
    }: {
        valid?: boolean
        matching?: MatchFn | PropMatchFnOpts | PropMatchFnOpts[]
        notMatching?: MatchFn | PropMatchFnOpts | PropMatchFnOpts[]
    }) {
        function apply(
            input: RecordedTelemetryEvent[],
            m: MatchFn | PropMatchFnOpts | PropMatchFnOpts[] | undefined,
            shouldMatch = true
        ) {
            if (m === undefined) {
                return input
            }
            if (typeof m === 'function') {
                return input.filter(v => m(v) === shouldMatch)
            }
            const propMatcher = isArray(m) ? m : [m]
            const matcherFn = propMatchFn(...propMatcher)
            return input.filter(v => matcherFn(v) === shouldMatch)
        }
        let filtered = this.events
        filtered = apply(filtered, matching)
        filtered = apply(filtered, notMatching, false)
        if (valid !== undefined) {
            filtered = filtered.filter(v => v.event.success === valid)
        }
        return filtered
    }
}

export type MatchFn = (event: RecordedTelemetryEvent) => boolean
export interface PropMatchFnOpts {
    action?: TelemetryEventAction<TelemetryEventFeature>
    feature?: TelemetryEventFeature
}
function propMatchFn(...opts: PropMatchFnOpts[]): MatchFn {
    return ({ event }) => {
        for (const opt of opts) {
            const matchesFeature = opt.feature !== undefined ? opt.feature === event.data?.feature : true
            const matchesAction = opt.action !== undefined ? opt.action === event.data?.action : true

            if (matchesFeature && matchesAction) {
                return true
            }
        }
        return false
    }
}
