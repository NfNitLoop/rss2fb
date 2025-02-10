#!/usr/bin/env -S deno run --allow-read --allow-net --deny-env

import { load as loadConfig, type Feed } from "./src/config.ts"
import { errorContext } from "./src/logging.ts"
import * as diskuto from "@diskuto/client"
import * as rss from "@mikaelporttila/rss"
import * as html from "jsr:@std/html@1/entities"


import { htmlToMarkdown } from "./src/markdown.ts";
import { Command, EnumType } from "@cliffy/command";
import { create, ItemSchema, PostSchema, ProfileSchema, toBinary } from "@diskuto/client/types";
import * as toml from "@std/toml"
import * as lt from "@logtape/logtape"
import type { LogLevel } from "@logtape/logtape";

const log = lt.getLogger("rss-sync")

async function main(): Promise<void> {
    await command.parse()
}

async function syncCommand(options: MainOptions): Promise<void> {  
    const logLevel = options.trace ? "trace" : options.debug ? "debug" : "info"
    await configureLogging(logLevel)
    log.debug("options: {options}", { options })
    
    log.debug(`Log level: {logLevel}`, {logLevel} )
    
    log.debug("Loading config from {filePath}", {filePath: options.config})
    const config = await errorContext(
        `Reading ${options.config}`,
        () => loadConfig(options.config)
    )
    
    log.debug(`server URL: {url}`, {url: config.diskutoApi})
    const client = new diskuto.Client({baseUrl: config.diskutoApi})

    
    const errors = []
    
    // TODO: Can do these in parallel? But logging might get noisy.
    for (const feedConfig of config.feeds) {
        // Don't stop syncing all feeds due to an error in one:
        try {
            await errorContext(
                `Syncing items for ${feedConfig.name || feedConfig.rssUrl}`,
                () => syncFeed(feedConfig, client)
            )
        } catch (error) {
            log.error("Error: {error}", {error})
            errors.push(error)
        }
    }
    
    if (errors.length > 0) {
        log.error("{count} errors during sync.", {count: errors.length})
        Deno.exit(1)
    }
}

async function updateProfilesCommand(options: UpdateProfilesOpts) {
    const config = await errorContext(
        `Reading ${options.config}`,
        () => loadConfig(options.config)
    )
    log.debug(`server URL: ${config.diskutoApi}`)
    const client = new diskuto.Client({baseUrl: config.diskutoApi})

    for (const feed of config.feeds) {
        await errorContext(
            `Updating profile for ${feed.name || feed.rssUrl}`,
            () => updateProfile(feed, client)
        )
    }
}

function genKeysCommand(_opts: unknown, ...args: GenKeysArgs) {
    const [count] = args

    const feeds: Feed[] = []

    for (let i = 0; i < count; i++) {
        const secretKey = diskuto.PrivateKey.createNew()
        feeds.push({
            name: "TODO", 
            rssUrl: "TODO",
            userId: secretKey.userID,
            secretKey, 
        })
    }
    const tomlOut = {
        feeds: feeds.map(f => {
            return {
                ...f,
                userId: f.userId.asBase58,
                secretKey: f.secretKey.asBase58
            }
        })
    }

    console.log(toml.stringify(tomlOut))
}

async function inspectCommand(opts: InspectOpts, ...[url]: InspectArgs): Promise<void> {
    await configureLogging()

    const {limit} = opts
    
    const feed = await readRSS(url)
    const feedInfo = {...feed, entries: "(skipped)"}
    console.log(feedInfo)
    
    for (const entry of feed.entries.slice(0, limit)) {
        console.log("--- Entry:")
        console.log(entry)
        console.log("output:")
        FeedItem.fromEntry(entry)?.print()
    }
}


// Utility types to extract cliffy command types:
type CommandOptions<C> = C extends Command<infer T1, infer T2, infer T3, infer T4, infer T5, infer T6, infer T7, infer T8> ? T3 : never
type CommandArgs<C> = C extends Command<infer T1, infer T2, infer T3, infer T4, infer T5, infer T6, infer T7, infer T8> ? T4 : never

const DEFAULT_CONFIG = "rss-sync.toml"

const logLevel = new EnumType(["info", "trace", "debug", "warn", "error"])


type MainOptions = CommandOptions<typeof mainCmd>
const mainCmd = new Command()
    .type("logLevel", logLevel)
    .name("sync")
    .description("sync the RSS feed into Diskuto")
    .option("--config <string>", "The path to the config file", {
        default: DEFAULT_CONFIG
    })
    .option("--debug", "enable debug logging")
    .option("--trace", "enable trace logging")
    .action(syncCommand)

type UpdateProfilesOpts = CommandOptions<typeof updateProfilesCmd>
const updateProfilesCmd = new Command()
    .name("updateProfiles")
    .description(
        "Create/Update profiles for each feed."
        + "\nRun this once after editing your config file."
    )
    .option("--config <string>", "The path to the config file", {
        default: DEFAULT_CONFIG,
    })
    .action(updateProfilesCommand)

type GenKeysArgs = CommandArgs<typeof genKeysCmd>
const genKeysCmd = new Command()
    .name("genKeys")
    .description(
        "Generate new userId/secretKey pairs for new feeds."
        + "\nOutputs toml placeholders that you can copy/paste into your config file."
    )
    .arguments<[number]>("<count:number>")
    .action(genKeysCommand)

type InspectArgs = CommandArgs<typeof inspectCmd>
type InspectOpts = CommandOptions<typeof inspectCmd>
const inspectCmd = new Command()
    .name("inspect")
    .description("See how a particular RSS feed would be rendered into Diskuto")
    .option("--limit <limit:number>", "Limit the number of entries to show", {default: 10 as number})
    .arguments("<rssUrl>")
    .action(inspectCommand)

const command = new Command()
    .name("rss-sync")
    .description("Sync RSS feeds to Diskuto")
    .default("help")
    .command(mainCmd.getName(), mainCmd)
    .command(updateProfilesCmd.getName(), updateProfilesCmd)
    .command(genKeysCmd.getName(), genKeysCmd)
    .command(inspectCmd.getName(), inspectCmd)
    .command("help", new Command().action(() => {
        command.showHelp()
    }))


// Look, uh, if your RSS feed is giant we're only going to look at the first 200.
const MAX_FEED_ITEMS = 200

async function syncFeed(feedConfig: Feed, client: diskuto.Client) {
    log.info(`Syncing Feed: {name}`, {name: feedConfig.name})
    const userID = feedConfig.userId
    
    const feed = await readRSS(feedConfig.rssUrl)
    let itemsToStore: FeedItem[] = []
    for (const entry of feed.entries.slice(0, MAX_FEED_ITEMS)) {
        const item = FeedItem.fromEntry(entry)
        if (!item) { continue }
        itemsToStore.push(item)
    }
    
    if (itemsToStore.length == 0) {
        log.warn("Feed had no items", {feedName: feedConfig.name})
        return
    }
    log.debug("Found {count} items in RSS feed", {count: itemsToStore.length})
    
    // Sort oldest first. We'll sync oldest first to make resuming work better.
    itemsToStore.sort(FeedItem.sortByDate)
    
    // Filter out duplicates by GUID:
    const oldestTimestamp = itemsToStore[0].timestampMsUTC
    log.debug("Calling getSeenGuids()...")
    const seenGUIDs = await getSeenGUIDs(client, userID, oldestTimestamp)
    log.debug("Found {count} preexisting GUIDs", {count: seenGUIDs.size})
    itemsToStore = itemsToStore.filter(i => !seenGUIDs.has(i.guid))
    log.debug("After filtering, {count} new items remain to be posted", {count: itemsToStore.length})
    if (itemsToStore.length == 0) {
        return
    }
    
    // PUT items, finally!  Yay!
    const privKey = feedConfig.secretKey
    for (const item of itemsToStore) {
        const bytes = item.toProtobuf()
        const sig = privKey.sign(bytes)
        await client.putItem(userID, sig, bytes)
        log.debug(`Stored item: {guid}`, {guid: item.guid})
    }

    log.info(`Stored ${itemsToStore.length} new items.`)
}


async function updateProfile(feedConfig: Feed, client: diskuto.Client) {
    const displayName = feedConfig.name
    
    const profileText = [
        `Posts from <${feedConfig.rssUrl}>`,
        "",
        "Sync'd by [@diskuto/rss-sync](https://jsr.io/@diskuto/rss-sync)",
    ].join("\n")
    
    const userID = feedConfig.userId
    const result = await client.getProfile(userID)
    if (result) {
        const profile = result.item.itemType.value
        if (profile.displayName == displayName && profile.about == profileText) {
            log.info("No changes for", {displayName})
            return
        }
    }
    
    const item = create(ItemSchema, {
        timestampMsUtc: BigInt(Date.now()),
        itemType: {
            case: "profile",
            value: create(ProfileSchema, {
                displayName,
                about: profileText
            })
        }
    })
    
    const privKey = feedConfig.secretKey
    const itemBytes = toBinary(ItemSchema, item)
    const sig = privKey.sign(itemBytes)
    await client.putItem(userID, sig, itemBytes)
    log.info("Updated", {displayName})
}

const ONE_WEEK_MS = 1000 * 60 * 60 * 24 * 7;

// Collect GUIDs from previously posted Items:
async function getSeenGUIDs(client: diskuto.Client, userID: diskuto.UserID, oldestTimestamp: number): Promise<Set<string>>
{
    const guids = new Set<string>()
    
    // NYTimes in particular realllly likes to edit their posts a lot.
    // Look back at least a week from the oldest record we got to make sure
    // we haven't already seen any of these already:
    const cutoff = oldestTimestamp - ONE_WEEK_MS;
    
    const entries = client.getUserItems(userID)
    for await (const entry of entries) {
        if (entry.timestampMsUtc < cutoff) { break }
        
        const sig = diskuto.Signature.fromBytes(entry.signature!.bytes)
        log.debug(`Item sig:`, {ts: entry.timestampMsUtc, sig: sig.asBase58})
        
        const item = await client.getItem(userID, sig)
        if (item?.itemType.case != "post") { continue }
        const body = item.itemType.value.body
        const guid = findGUID(body)
        if (guid) { guids.add(guid) }
    }
    
    return guids
}




interface ItemData {
    guid: string,
    title?: string,
    markdown: string,
    published: Date,
}

class FeedItem {
    readonly guid: string
    readonly title: string|undefined
    readonly markdown: string
    readonly published: Date
    readonly timestampMsUTC: number
    
    constructor({guid, title, markdown, published}: ItemData) {
        this.guid = guid
        this.title = title
        this.markdown = markdown
        this.published = published
        this.timestampMsUTC = published.valueOf()
        
        if (this.timestampMsUTC == 0) {
            throw "a FeedItem's Date may not be exactly UNIX Epoch."
            // It likely means you've got an error in date parsing somewhere anyway.
        }
    }
    
    static sortByDate(a: FeedItem, b: FeedItem): number {
        return a.timestampMsUTC - b.timestampMsUTC
    }
    
    toProtobuf(): Uint8Array {
        const item = create(ItemSchema, {
            timestampMsUtc: BigInt(this.timestampMsUTC),
            // NOTE: No offset, since JS Date (nor rss's JSONFeed data type) support it.
            itemType: {
                case: "post",
                value: create(PostSchema, {
                    title: this.title,
                    body: this.markdown
                })
            }
        })
        
        return toBinary(ItemSchema, item)
    }

    print() {
        console.log("#", this.title, "#")
        console.log()
        console.log("published:", this.published)
        console.log()
        console.log(this.markdown)
        console.log()
    }
    
    static fromEntry(item: rss.FeedEntry): FeedItem | null {

        const guid = item.id

        // Some blogs may only publish a modified date.
        // We'll prefer published, because we're not going to update
        // with each update.
        const published = item.published ?? item["dc:modified"]
        
        if (!published) {
            log.warn(`Item does not have a published or modified date. Skipping`, {guid})
            return null
        }

        
        const body = item.content ?? item.description
        let markdown = htmlToMarkdown(body?.value)


        const url = item.links[0]?.href
        if (url) { 
            markdown = addURL(markdown, url)
        }
        markdown = addGUID(markdown, item.id)
        
        return new FeedItem({
            guid,
            published,
            markdown,
            title: getText(item.title)
        })   
    }
    
}

// Add the RSS item's URL to the end of the article if it's not included already.
function addURL(markdown: string, url: string): string {
    if (markdown.search(url) >= 0) {
        // URL already in the body.
        return markdown
    }
    
    return (
        markdown.trimEnd()
        + "\n\n"
        + `[Continue Reading…](${url})`
    )
}

// Add the RSS item GUID to the end of a post. Allows us to retrieve GUIDs later.
function addGUID(markdown: string, guid: string): string {
    return (
        markdown.trimEnd()
        + "\n\n"
        + `<!-- GUID: "${normalizeGUID(guid)}" -->`
    )
}

function normalizeGUID(value: string|undefined): string {
    // We seem to be getting "undefined" from MotherJones. Maybe they're not specifying the GUID?
    // Quick hacks to let it through. No GUIDs for you.
    if (!value) { return "undefined" }
    
    // Remove " from GUIDs because we enclose them in quotes.
    // also remove > to prevent breaking out of our HTML <!-- comment -->:
    return value.replaceAll(/[">]/g, "")
}

const GUID_PATTERN = /^\<!-- GUID: "([^">]+)" -->/mg

// Find a GUID from a previous post.
function findGUID(markdown: string): string|null {
    const results = [...markdown.matchAll(GUID_PATTERN)]
    if (results.length == 0) {
        return null
    }
    if (results.length > 1) {
        log.warn("Found more than one GUID. Using first one.")
    }
    
    const match = results[0]
    return match[1] // guid captured in group 1.
}

async function readRSS(url: string): Promise<rss.Feed> {
    const response = await fetch(url);
    const xml = await response.text();
    log.debug("xml: {xml}", {xml, trace: true})
    return await rss.parseFeed(xml);
}

type TextField = rss.Feed["title"]

function getText(field: TextField|undefined): string|undefined {
    const value = field?.value
    if (!value) { return value }
    
    if (field.type == "html" || field.type == "xhtml") {
        return html.unescape(value)
    }
    return value
}


async function configureLogging(logLevel: LogLevel|"trace" = "debug") {
    const traceEnabled = logLevel == "trace"
    await lt.configure({
        loggers: [
            { 
                // This seems to act as a root category (which is handy!)
                // ... but I don't see it documented anywhere.
                category: [],

                lowestLevel: logLevel == "trace" ? "debug" : logLevel,
                sinks: ["console"],
                filters: ["trace"]
            },
            { category: ["logtape", "meta"], lowestLevel: "warning" },
        ],
        sinks: {
            console: lt.getConsoleSink(),
        },
        filters: {
            trace: (rec) => traceEnabled || rec.properties.trace !== true
        }
    })
}



// --------------------------
if (import.meta.main) {
    await main()
}