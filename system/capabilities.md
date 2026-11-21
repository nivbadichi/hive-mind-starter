# Capability map

What you have to work with, by kind of work: skills, connectors, ready-made parts and protocols. Rule 14 says to use everything that fits; this map is where Claude looks first.

**Fill it in with what you have installed.** It starts with kinds only. Ask Claude "fill in my capability map": it lists your installed skills and connected connectors, puts each one under the kinds of work it fits, and asks you before marking anything "use". Change it any time.

**How to use it**
1. Find the kind of work. Copy its skills, connectors, parts and protocols into the build brief (`core/templates/build-brief.md`).
2. Load every skill listed with the Skill tool; a skill not loaded is not used. Say in the report what was skipped and why (rule 14).
3. A tool not marked "use" is not used without your yes. Anything that is not an official or directory connector gets `hive-review` first (rule 10).

Life cycle (rule 4): discover, define, plan, design, build, verify, release, maintain, close.

## 1. Research and precedents

| | |
|---|---|
| Skills | Kinds: web research and reports; reading links and platforms; real screen references; finding new skills. Yours: <fill in> |
| Connectors | Kinds: a browser for public pages. Use for: <fill in>. Not for this: <fill in> |
| Ready parts | Kinds: reference galleries of real sites and app screens; your own list of precedents. <fill in> |
| Protocol | `hive-scout` (a set budget, ends in a shortlist); rule 13 (name each precedent and what was taken); `hive-review` for any tool that is not official or directory; research needs no yes (rule 3) |

## 2. Design direction

| | |
|---|---|
| Skills | Kinds: interface design and critique; avoiding generic-looking design; brand-style references; visual polish. Yours: <fill in> |
| Connectors | Kinds: a design tool (for example a Figma-type connector), a browser to look at live references. <fill in> |
| Ready parts | The project's design direction note (its fixed picks; read first, the design gate asks for it), your taste notes in `me/` |
| Protocol | `hive-scout` step 5; read the direction note before any design; the design stage of rule 4; the picks are fixed, later comments adjust them |

## 3. Wireframes and sketches

| | |
|---|---|
| Skills | Kinds: interface design; turning a drawing into code. Yours: <fill in> |
| Connectors | Kinds: a design tool; a whiteboard tool. <fill in> |
| Ready parts | The project's brief or spec note |
| Protocol | Design stage of rule 4; rule 13; record the precedents used; you approve sketches before building |

## 4. Front-end build

| | |
|---|---|
| Skills | Kinds: building screens from a design; picking a library; mobile web feel; component libraries. Yours: <fill in> |
| Connectors | Kinds: a code host (for example GitHub), a hosting service, a design tool, a browser for previews. <fill in> |
| Ready parts | Kinds: open component libraries and animated parts. Record each with its licence in `system/catalogue.md` |
| Protocol | Build inside approved steps only (rule 4); ask before installing or connecting (rule 1); `hive-review` for non-directory tools; the privacy check at every save |

## 5. Motion

| | |
|---|---|
| Skills | Kinds: building animation; animation performance; reviewing motion; naming effects. Yours: <fill in> |
| Connectors | Kinds: a browser to watch it move. <fill in> |
| Ready parts | Kinds: animation libraries and animated components, each with its licence in `system/catalogue.md` |
| Protocol | Transform and opacity first; reduced motion respected; phone speed measured, or said "not measured" |

## 6. Text and voice

| | |
|---|---|
| Skills | Kinds: plain-language copy; documents. Yours: <fill in> |
| Connectors | Kinds: a document editor you share drafts in. <fill in> |
| Ready parts | Voice precedents you like. <fill in> |
| Protocol | Rule 6 (plain, short); rule 4 (ask purpose, reader and size before writing); `hive-capture` for each wording decision |

## 7. Review and testing

| | |
|---|---|
| Skills | Kinds: interface review; accessibility; stress tests with worst-case data; browser testing; code review; debugging; security review. Yours: <fill in> |
| Connectors | Kinds: a browser for real run-throughs at phone and laptop sizes; the code host for the changes. <fill in> |
| Ready parts | The project's own list of checks |
| Protocol | Verify stage of rule 4; rule 5 (say what was checked and what was not); a reviewer separate from the builder; a check that passes on zero items is not a check |

## 8. Publishing

| | |
|---|---|
| Skills | Kinds: scheduled and recurring runs; deployment. Yours: <fill in> |
| Connectors | Kinds: a hosting service; the code host for your private notes. <fill in> |
| Ready parts | Only your page's folder is ever published; a public build is searched for real data first |
| Protocol | Rule 1 (anything public or leaving the computer needs your yes); the privacy check at every save; `hive-capture` for the decision; an undo noted for each step |

## 9. Documents

| | |
|---|---|
| Skills | Kinds: documents, PDFs, slides, spreadsheets; writing notes for agents. Yours: <fill in> |
| Connectors | Kinds: a document, spreadsheet and slides suite; a file drive. <fill in> |
| Ready parts | The project profile and build brief templates in `core/templates/` |
| Protocol | Rule 4 (purpose, reader and size first); rule 6; `hive-capture` |

## 10. Data

| | |
|---|---|
| Skills | Kinds: analysis; charts and dashboards; checking an analysis. Yours: <fill in> |
| Connectors | Kinds: a spreadsheet; an analytics service, only if you add one. <fill in> |
| Ready parts | Kinds: chart and dashboard libraries, each with its licence |
| Protocol | Rule 5 (proof); say what is collected before any analytics; rule 1 before anything leaves the computer |

## Gaps

Nothing written yet. Note here any kind of work that has no skill, connector or part yet.
