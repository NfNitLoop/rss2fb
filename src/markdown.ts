import * as nhm from "node-html-markdown"

// node-html-markdown is the best html-to-markdown parser I've found that
// works with Deno at the moment.
const service = new nhm.NodeHtmlMarkdown({
    // https://github.com/crosstype/node-html-markdown#readme

    // Thank you! :) https://github.com/crosstype/node-html-markdown/issues/15  
    useLinkReferenceDefinitions: true,
})

export function htmlToMarkdown(html?: string): string {
    return service.translate(html || "")
}
