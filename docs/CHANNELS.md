# Channel names and the roster

Every channel the server creates is named automatically; a `name_override` is the only name that is the
user's (`docs/DATA-MODEL.md`). The automatic names come from one roster, `NETWORKS` in
`src/channels.js:15-124`, and follow three rules:

1. **A network is a brand word, and its channels lead with it.** `Nightshade` is the network;
   `Nightshade` (shows) and `Nightshade Grindhouse` (films) are two of its channels.
2. **The medium is never in the name.** No `TV`, `Cinema`, `Movies` or `FM`: the number band, the
   guide's filter and the logo lockup are what say which is which.
3. **Brand repetition is the point; generic repetition is the defect.** Three channels all saying
   "Cinema" describe nothing; three saying `Nightshade` describe a network.

Real networks are lumpy, so not every genre has a sibling: four film genres carry a brand of their own,
because their television counterpart belongs to a different network.

A genre that is **not** on the roster invents no channel. The item falls to the catch-all for its medium
(below), because a genre nobody funded is not a brand.

## Scripted networks: a show channel and a film channel, 200 apart

| Network | Television | Film | Numbers (TV / film) |
|---|---|---|---|
| Nightshade | Nightshade | Nightshade Grindhouse | 110 / 310 |
| Nailbiter | Nailbiter | Nailbiter After Dark | 113 / 313 |
| Chortle | Chortle | Chortle House | 116 / 316 |
| Longform | Longform | Longform Goldleaf | 119 / 319 |
| Herringbone | Herringbone | Herringbone Cipher | 122 / 322 |
| Gavel | Gavel | Gavel Lineup | 125 / 325 |
| Slowburn | Slowburn | Slowburn Candlelight | 128 / 328 |
| Warpwell | Warpwell | Warpwell Deep Field | 131 / 331 |
| Runegate | Runegate | Runegate Mythos | 134 / 334 |
| Hearthside | Hearthside | Hearthside Popcorn | 137 / 337 |
| Inkwell | Inkwell | Inkwell Flipbook | 140 / 340 |
| Fieldwork | Fieldwork | — | 143 / — |
| Redline | Redline | Redline Blast Radius | 146 / 346 |
| Trailhead | Trailhead | Trailhead Compass Rose | 149 / 349 |
| Foxhole | Foxhole | Foxhole Beachhead | 152 / 352 |
| Dustline | Dustline | — | 155 / — |
| Recollect | Recollect | Recollect Monolith | 158 / 358 |
| Portrait | Portrait | Portrait Testament | 161 / 361 |
| Backbeat | Backbeat | Backbeat Amplifier | 164 / 364 |
| Marquee | Marquee | — | 167 / — |

Six more channels share a network without pairing with one:

| Channel | Network | Genres |
|---|---|---|
| Chortle Open Mic | Chortle | stand-up |
| Longform Short Season | Longform | mini-series |
| Longform Teleplay (film) | Longform | tv movie |
| Slowburn Longstory | Slowburn | soap |
| Hearthside Kites | Hearthside | children, kids |
| Inkwell Cel Frame | Inkwell | anime |

## Film-only brands

| Channel | Number | Genre |
|---|---|---|
| Verity | 370 | documentary |
| Tumbleweed | 373 | western |
| Overture | 376 | musical |
| Guffaw | 379 | comedy |

## One-brand television channels

| Channel | Number | Genre |
|---|---|---|
| Buzzer | 170 | game show |
| After Hours | 173 | talk |
| Unscripted | 176 | reality |
| Skillet | 179 | food |
| Passages | 182 | travel |
| Curio | 185 | special interest |
| Extra Time | 188 | sport |
| Bulletin | 191 | news |
| Small Print | 194 | indie |

## Music: one channel and one station on a brand

The video channel is the bare brand; the station is the same brand plus a **dial position**, the way a
real station is known by its frequency. Radio folds sub-genres into one family (Indie Rock, Hard Rock
and Rock are one station); music video keeps one channel per genre tag, so a second sub-genre of the
same brand is told apart by its genre in brackets.

| Video channel | Station | Genres |
|---|---|---|
| Blocks | Blocks 92.1 | hip, rap |
| Velour | Velour 94.7 | r&b, soul, funk |
| Strobe | Strobe 88.3 | dance, electro, house, techno, trance |
| Anvil | Anvil 96.2 | metal |
| Pin | Pin 90.9 | punk |
| Bedsit | Bedsit 91.7 | indie, alternative |
| Watt | Watt 98.4 | rock |
| Gloss | Gloss 100.1 | pop |
| Dusty | Dusty 87.9 | country |
| Cadence | Cadence 103.2 | jazz |
| Smokestack | Smokestack 89.5 | blues |
| Kindling | Kindling 90.3 | classical |
| Tidepool | Tidepool 95.8 | reggae |
| Moonshine | Moonshine 93.6 | folk |
| Score | Score 97.5 | soundtrack |
| Caliente | Caliente 99.1 | latin |
| Hallyu | Hallyu 101.8 | k-pop |

## Eras: deliberately not network-branded

An era is its own identity; it is not "the old-film channel of a brand".

| Era | Film | Music video | Radio |
|---|---|---|---|
| pre-1960 | Nitrate | Shellac | Wireless |
| 1960s | Pop Art | — | — |
| 1970s | Grain | Glitter | AM Gold |
| 1980s | Neon | VHS | Cassingle |
| 1990s | Rental | Dial-Up | Minidisc |
| 2000s | Millennium | Ringtone | MP3 |
| 2010s | Widescreen | Feed | Streamline |
| 2020s | Now | Loop | Airwave |

A dash is a medium that has no channel for that era: a 1960s music video stays on its genre station
rather than being filed under a name nobody chose. Era channels are off for films and music videos by
default (`movieDecadeChannels`, and the radio decades are always on, `docs/SETTINGS.md`).

## Catch-alls

| Medium | Channel | Network | When |
|---|---|---|---|
| shows | The Spare | `the-spare` | no studio tag reached the threshold and no genre is on the roster |
| films | Backlot | `backlot` | the same, for films |
| music video | The B-Side | `the-b-side` | the same, for music videos |
| radio | Frequency | `frequency` | the same, for tracks |

## Numbers

`number` is assigned once, when the channel is created (`src/channels.js:407-421`); a channel that
exists keeps the number it has, and `src/server.js:293-296` lets the owner pin one by hand. The number in
the tables above is the block the roster reserves for the network, which is why a network's two numbers
are 200 apart and why the bands are not shared: a network added later takes the next free slot in its
band and renumbers nobody.

Studio, group, talk and live channels are outside the roster and carry no `network`.

## Where this lives

| Thing | Where |
|---|---|
| the roster, and which genre reaches which channel | `src/channels.js:15-134` |
| the music families and the station dial positions | `src/channels.js:136-165` |
| the era table | `src/channels.js:167-186` |
| the catch-alls | `src/channels.js:188-195` |
| the `network` column | `src/db.js:47-51` (fresh), `src/db.js:129-130` (upgrade) |
| what a scan produces | `test/channelnames.test.js` |

