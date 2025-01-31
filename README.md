rss-sync
==============

Run this script periodically to make RSS feeds available in your [Diskuto] feed.

Installation
------------

1. Install [Deno].
2. `deno install --allow-read --allow-net --deny-env jsr:@diskuto/rss-sync`

Setup & Use
-----------

1. Create an `rss-sync.toml` in your current directory, following the [sample].

   You can use the `rss-sync genKeys` command to generate new userIDs for each blog.
   (Each should use a separate key so that their sync state remains independent.)

2. Make sure to follow those IDs from a user on your Diskuto server. This will
   grant them write access to that server.

3. Run `rss-sync updateProfiles` once, to create/update a Diskuto profile for each
   RSS feed.

4. Periodically run `rss-sync sync` to fetch new news.

[Deno]: https://deno.com/
[Diskuto]: https://github.com/diskuto/
[sample]: ./rss-sync.toml.sample