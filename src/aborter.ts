
/**
 * Simplifies aborting `fetch()` requests after a timeout, or an exception is thrown.
 */
export class Aborter implements Disposable {
    #timeoutMs: number
    #scopeEnded = new AbortController();

    constructor({timeoutMs}: Readonly<Options>) {
        this.#timeoutMs = timeoutMs
    }

    /**
     * A wrapper for fetch() that automatically sets up an abort signal.
     */
    fetch(input: FetchParams[0], init?: FetchParams[1]): FetchReturn {
        const signals = [
            this.#scopeEnded.signal,
            AbortSignal.timeout(this.#timeoutMs),
        ]

        const requestSignal = input instanceof Request ? input.signal : null
        if (requestSignal) { signals.push(requestSignal) }

        const initSignal = init?.signal
        if (initSignal) { signals.push(initSignal) }

        return fetch(input, {
            ...init,
            signal: AbortSignal.any(signals)
        })
    }

    [Symbol.dispose]() {
        this.#scopeEnded.abort("Aborter has exited scope.")
    }
}

type Options = {
    /** Time after which a request will be automtically aborted. */
    timeoutMs: number
}

type FetchParams = Parameters<typeof fetch>
type FetchReturn = ReturnType<typeof fetch>