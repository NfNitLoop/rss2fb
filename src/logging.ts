export type LogLevel = "error"|"warn"|"info"|"debug"|"trace"

// A logger with .log() methods that are compatible with console.log(...) signature.
export class Logger {

    /** Log unconditionally  */
    log(...args: unknown[]) {
        console.log(...args)
    }

    error(...args: unknown[]) {
        if (this.levelNum < 1) { return }
        this.log("ERROR:", ...args)
    }
    warn(...args: unknown[]) {
        if (this.levelNum < 2) { return }
        this.log("WARN:", ...args)
    }

    info(...args: unknown[]) {
        if (this.levelNum < 3) { return }
        // Note: INFO is the default log level, so we don't prefix it:
        this.log(...args)
    }

    debug(...args: unknown[]) {
        if (this.levelNum < 4) { return }
        this.log("DEBUG:", ...args)
    }

    trace(...args: unknown[]) {
        if (this.levelNum < 5) { return }
        this.log("TRACE:", ...args)
    }

    async time<T>(message: string, callback: () => T) {
        const timer = new Timer()
        this.debug("TIME START:", message)
        try {
            return await callback()
        } finally {

            this.debug("TIME END:", message, "after", timer.elapsed.toString())
        }
    }
        
    // Start at "info" by default:
    private _levelNum = 3;

    get level() {
        switch(this._levelNum) {
            case 1: return "error";
            case 2: return "warn";
            case 3: return "info";
            case 4: return "debug";
            case 5: return "trace";
        }
        return "trace"
    }

    increaseLevel(inc: number) {
        this.levelNum += inc
    }

    set levelNum( newValue: number) {
        newValue = Math.round(newValue)
        if (newValue < 1) { newValue = 1 }
        if (newValue > 5) { newValue = 5 }
        this._levelNum = newValue
    }
    get levelNum() { return this._levelNum }
}

/** Provide some error context when errors happen. */
export async function errorContext<T>(message: string, callback: () => Promise<T>): Promise<T> {
    try { 
        return await callback() 
    } catch (cause) { 
        throw new ErrorContext(message, cause)
    }
}

class ErrorContext {
    contextMessage: string
    cause: unknown
    constructor(message: string, cause: unknown) {
        this.contextMessage = message
        this.cause = cause
    }

    toString() {
        return `${this.contextMessage}:\n    ${this.cause}`
    }
}

class Timer {
    started: number

    constructor() {
        this.started = new Date().valueOf()
    }

    restart() {
        this.started = new Date().valueOf()
    }

    get elapsed(): TimeDelta {
        return new TimeDelta(new Date().valueOf() - this.started)
    }
}

class TimeDelta {
    constructor(public readonly ms: number) {}

    toString(): string {
        // TODO: Can make this more human readable later for big values.
        return `${this.ms}ms`
    }
}