# Testing gaps

A review of the suite against the journeys a real user takes: what is untested,
why it matters, and where to start.

Each entry is tracked as an issue. This document is the overview; the issues are
where the work is claimed and closed.

| #   | Gap                                       | Issue                                                              |
| --- | ----------------------------------------- | ------------------------------------------------------------------ |
| 1   | The custom flag upload path               | [#5](https://github.com/ZanattaMichael/AoE2-Civbuilder/issues/5)   |
| 2   | Share links, and the view/edit round trip | [#6](https://github.com/ZanattaMichael/AoE2-Civbuilder/issues/6)   |
| 3   | The combine compatibility check           | [#7](https://github.com/ZanattaMichael/AoE2-Civbuilder/issues/7)   |
| 4   | The builder's validation gates            | [#8](https://github.com/ZanattaMichael/AoE2-Civbuilder/issues/8)   |
| 5   | Tech tree editing                         | [#9](https://github.com/ZanattaMichael/AoE2-Civbuilder/issues/9)   |
| 6   | Modifier effects on the generated mod     | [#10](https://github.com/ZanattaMichael/AoE2-Civbuilder/issues/10) |
| 7   | Board filters and card counts             | [#11](https://github.com/ZanattaMichael/AoE2-Civbuilder/issues/11) |
| 8   | Vanilla civilizations beyond the first    | [#12](https://github.com/ZanattaMichael/AoE2-Civbuilder/issues/12) |
| 9   | Real `create-data-mod` output             | [#13](https://github.com/ZanattaMichael/AoE2-Civbuilder/issues/13) |
| 10  | The draft-to-mod journey                  | [#14](https://github.com/ZanattaMichael/AoE2-Civbuilder/issues/14) |

The suite already covers the central path end to end: authoring a civilization
with real choices, combining several into a mod, and downloading it
(`e2e/civilization.spec.js`, `e2e/combine.spec.js`). What follows is what it
still does not reach.

---

## 1. The custom flag upload path

**Untested.** `#customImageCheckbox` and `#customImageInput` in the flag creator
set `civ.customFlag` and `civ.customFlagData`; no test touches either, so
`customFlagData` is always `""`.

**Why it matters.** This is the only place a user supplies arbitrary binary
content, and it is carried as a base64 string through the entire system: into
the exported JSON, back in through the combine picker, across the `/create`
request body, and into the mod's `civ_emblems`.

Specifically uncovered:

- Uploading an image sets `customFlag` and populates `customFlagData`.
- The exported document round-trips through combine with the image intact.
- The generated mod carries the uploaded emblem rather than a palette flag.
- The client's size guards in `public/js/client.js` — a warning above 1MB and an
  abort above 5MB across the selected files.
- The server's `BODY_LIMIT` when a large flag pushes the request past it.

**Where to start.** Add a `customFlag` option to `authorCivilization` in
`e2e/helpers.js` that calls `setInputFiles` on `#customImageInput` with a
generated PNG buffer. `page.on("dialog")` captures the size-guard alerts;
generating the oversized buffer in the test avoids committing a large fixture.
`e2e/zip.js` can then open the mod to confirm the emblem landed.

---

## 2. Share links, and the view/edit round trip

**Untested.** The board's Share control (`#clear`) builds `/view?civ=…` and
`/edit?civ=…` links from `encryptJson(civ)`. Neither the links nor the pages
they point at are covered, and `public/js/edit.js` is 1,510 lines — the largest
untested file in the project.

**Why it matters.** This is how civilizations are shared between users. A
serialisation change breaks every link previously handed out, silently.

Specifically uncovered:

- Share produces links that decode back to the civilization that was authored.
- `/view` renders a shared civilization.
- `/edit` loads one back into the builder, and re-exporting preserves it.
- The `#editCiv` and `#viewButton` upload paths on the home page.
- A malformed or truncated `?civ=` payload fails gracefully rather than
  throwing.

**Where to start.** A round-trip spec: author, Share, read the link text, visit
`/edit?civ=…`, and assert the loaded civilization deep-equals the original.

---

## 3. The combine compatibility check

**Untested.** `checkCompatibility` in `public/js/client.js` runs before every
combine and can abort it. Nothing exercises it.

**Why it matters.** It is the only thing standing between a user and a mod that
will not load, and it fails _closed_ — a false positive silently blocks a
legitimate combine.

Specifically uncovered:

- The 50-civilization cap (`numCivs` in `public/js/common.js`).
- Duplicate-bonus detection across the 17 tracked conflict classes.
- The data-mod versus UI-mod distinction: conflicts below index 7 abort the
  creation, conflicts at or above it only warn and continue.

**Where to start.** The conflict classes are keyed on specific card indices
(313, 102, …). Build presets that deliberately collide, feed them through the
picker as `e2e/combine.spec.js` does, and assert on the alert text and on
whether a download follows.

---

## 4. The builder's validation gates

**Untested.** The Share flow enforces a 275 tech-tree-point cap and a bonus
point budget before letting a civilization out.

**Why it matters.** These are the balance rules. A civilization that exceeds
them is not playable, and the cap is enforced only here.

**Where to start.** Author a civilization, pick past the cap, and assert Share
refuses with the "Maximum 275 techtree points" message.

---

## 5. Tech tree editing

**Untested.** The tech tree phase is clicked through — `authorCivilization`
waits for `#techtree`, lets it settle, and clicks `#done`. `civ.tree` is always
the default in every test.

**Why it matters.** The tech tree is half of what defines a civilization, and
`civ.tree` is one of the three arrays the generator consumes. It is also what
the point cap in gap 4 is computed from.

**Where to start.** The tree renders as SVG through
`public/aoe2techtree/js/techtree.js`. Identify the click targets for toggling a
unit, building and technology, toggle one of each, and assert the corresponding
`civ.tree[0..2]` entry changed and survives export.

---

## 6. Modifier effects on the generated mod

**Partially tested.** `e2e/combine.spec.js` asserts the modifier form's values
reach the `/create` request. Nothing asserts they change the mod.

**Why it matters.** `hp`, `speed`, `building`, `blind`, `infinity` and
`randomCosts` are applied during generation. The request carrying them proves
the client wired the form up, not that the server honoured them.

**Where to start.** Generate twice from the same seed and preset, once with
default modifiers and once with `hp: 2`, and assert the data mod differs. Note
that the local fixture stubs the native `.dat` rewriter, so this likely belongs
in the container run — see gap 9.

---

## 7. Board filters and card counts

**Untested.** The bonus board carries rarity filters (`raritySelect0`–`4`),
edition filters (`editionSelect0`–`1`), a text filter (`#filterinput`), and
per-card count controls (the `+`/`-` on a selected card, plus a `contextmenu`
handler).

**Why it matters.** The count controls are how `[card, count]` pairs ever get a
count above 1 — a shape the generator handles throughout and that no test has
ever produced. The filters are how a user finds a card among 363.

**Where to start.** Pick a card, click `+` twice, and assert
`civ.bonuses[0]` is `[[n, 3]]`. Separately, type into `#filterinput` and assert
the visible card count drops.

---

## 8. Vanilla civilizations beyond the first

**Partially tested.** `e2e/combine.spec.js` combines the first entry from
`VanillaJson.zip` with an authored civilization.

**Why it matters.** The archive holds every base-game civilization, and they are
the most likely input to a real combine. A parse failure in any one of them
breaks that user's mod with no clear message.

**Where to start.** Iterate every entry in the archive, assert each parses and
has the expected shape, and combine a handful in one mod.

---

## 9. Real `create-data-mod` output

**Environment-limited.** The local fixture stubs the native binary, so the
`.dat` in every locally generated mod is 8 bytes of placeholder.

**Why it matters.** The C++ rewriter is what actually produces the playable
mod. The container end-to-end job runs against the real binary and real assets,
so assertions about `.dat` contents belong there.

**Where to start.** Add assertions that run only when the binary is real —
`/readyz` reports whether it was found — checking the `.dat` is of plausible
size and carries the expected header, rather than the stub's placeholder.

---

## 10. The draft-to-mod journey

**Partially tested.** `e2e/draft.spec.js` covers drafting and
`e2e/api.spec.js` covers `POST /download` serving a completed draft's archive,
but no test runs a draft to completion and downloads the mod it produced.

**Why it matters.** Drafting is the site's other headline feature, and its
payoff is the same mod download the combine flow produces. The two halves are
tested; the seam between them is not.

**Where to start.** Extend `e2e/draft.spec.js`: run a two-player draft through
its rounds, then assert `/download` returns an archive containing both players'
civilizations, using the same `e2e/zip.js` assertions the combine specs use.
