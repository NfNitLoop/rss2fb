
import * as diskuto from "@diskuto/client"
import * as toml from "@std/toml"
import {z} from "zod"


export type Feed = z.infer<typeof Feed>
const Feed = z.object({
    name: z.string().min(1),
    rssUrl: z.string().url(),

    userId: z.string().min(1).transform((val, ctx) => {
        const id = diskuto.UserID.tryFromString(val)
        if (!id) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Invalid UserID"
            })
            return z.NEVER
        }
        return id
    }),

    secretKey: z.string().min(1).transform((val, ctx) => {
        try {
            return diskuto.PrivateKey.fromBase58(val)
        } catch (_) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Invalid secret key."
            })
            return z.NEVER
        }
    }),

}).strict().superRefine((feed, ctx) => {
    if (feed.userId.asBase58 != feed.secretKey.userID.asBase58) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "UserID and SecretKey don't match for feed: " + feed.name
        })
    }
})

export type Config = z.infer<typeof Config>
const Config = z.object({
    diskutoApi: z.string().url()
        .describe("Which Diskuto server should we write to?"),
    feeds: z.array(Feed).min(1)
}).strict().superRefine((config, ctx) => {
    const ids = new Set<string>()
    for (const feed of config.feeds) {
        const uid = feed.userId.asBase58
        if (ids.has(uid)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `UserID used multiple times: ${uid}`
            })
            return
        }
        ids.add(uid)
    }
})

export async function load(fileName: string): Promise<Config> {
    const obj = toml.parse(await loadFile(fileName))
    return Config.parse(obj)
}

async function loadFile(fileName: string): Promise<string> {
    try {
        return await Deno.readTextFile(fileName)
    } catch (error) {
        throw new Error(`Error reading file "${fileName}": ${error}`)
    }
}