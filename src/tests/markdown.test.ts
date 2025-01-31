// deno-lint-ignore-file prefer-const
import { assertEquals } from "jsr:@std/assert@1"

import { htmlToMarkdown } from "../markdown.ts";


Deno.test("spaces inside styles", () => {
    // Some RSS feeds have HTML with weird spacing like this:
    // (Possibly because they use CMSes to write HTML and not humans)
    let input = `Foo<em> <a href="#target">Bar</a> </em>baz`
    let output = htmlToMarkdown(input)

    let expected = unindent(`
        Foo _[Bar][1]_ baz

        [1]: #target
    `)

    // Make sure this doesn't happen again:
    assertEquals(output, expected)
})

Deno.test("link refs", () => {
    let input = unindent(`
        <p>Here is <a href="https://www.example.com/link1">an example</a>.</p>
        <p>Here's <a href="https://www.example.com/link2">another</a>.</p>
        <p>This uses <a href="https://www.example.com/link1">the same link</a> as before.</p>
    `)

    let output = htmlToMarkdown(input)
    let expected = unindent(`
        Here is [an example][1].
        
        Here's [another][2].
        
        This uses [the same link][1] as before.
        
        
        [1]: https://www.example.com/link1
        [2]: https://www.example.com/link2
    `)

    assertEquals(output, expected)
})


// Really? This isn't built into JS or Deno yet?
function unindent(text: string): string {
    let lines = text.split("\n")
    if (lines.length == 1) { return text }

    if (lines[0].trim() != "") {
        throw new Error(`Expected the first line to be blank but found ${lines[0]}`)
    }
    if (lines.at(-1)!.trim() != "") {
        throw new Error(`Expected the last line to be blank but found ${lines.at(-1)}`)
    }
    
    lines = lines.slice(1, -1)

    let indent = lines[0].match(/^\s*/m)![0]

    lines = lines.map(line => {
        let trim = line.startsWith(indent) ? indent.length : 0
        return line.substring(trim)
    })

    return lines.join("\n")
}