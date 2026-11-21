---
name: hive-scout
description: Scout for the best tools, connectors, components, libraries, templates and design references before a project's plan, review them, and suggest one shortlist. Use at the start of any new project or major feature, or when the user says scout.
---

# Scouting

Research and scouting need no approval. Installing anything does. This skill never installs, connects, signs in, pays or sends anything out. It ends in a shortlist for the user to approve.

Budget: starting limit of 10 searches and about 15 minutes. If it runs out, stop and say what was covered and what was not. Keep notes in plain words.

**The design gate depends on this skill.** Running it is what lets new screens, published pages, Figma drawings and design helpers through, in this chat (the `hive-gates` skill). Run it at the start of any design or build round, and again after the chat was shortened. Before step 1, read the project's design direction note (the `design_direction:` line of its state note) and the taste notes with the Read tool: the picks in that note are fixed, and every option you scout starts from them.

**Privacy:** for work done for an employer, or shared projects, keep confidential names and details out of searches and notes. Keep the profile high level.

## Steps

1. **Understand the project.** Read the goal and brief the user gave (ask one short question if the goal is unclear). Name the project type or types: website or front end, dashboard or admin tool, web app with a back end, mobile app, game, design system, agent ecosystem, or other.
2. **Read what is already known.** In `~/hive-mind`: the project's notes in `projects/<name>/`; `system/stack.md` if it exists (the user's standard kit: for each need on it, say whether this project has that need, and use its default unless something is clearly better); `system/catalogue.md` if it exists (earlier finds, rejected tools and review dates); `system/capabilities.md` (the skills, connectors and ready-made parts you have, by kind of work); and, for interface projects, any taste notes the user keeps in `me/`. Do not review again a tool that was reviewed recently, unless it changed.
2b. **Where it runs.** For any project with code, settle where it runs before anything else (group 3 of the checklist in `system/stack.md`): the project runs in Docker from its first day (one container definition kept with the code, the official image at an exact version, an ordinary user, an ignore file that lists what may enter the image), a helper tries its changes in a sealed container (no network, nothing of the computer mounted in), and the same image runs the tests on the computer and on GitHub. Say whether Docker is on the computer (`docker --version`, reading only); if it is missing, installing it is the person's yes, and every container line says "not run". Images are never pushed anywhere. Not tried yet in this copy.
3. **Search, within the budget:**
   - the web, for the best current tools and practice for this exact kind of project;
   - the connector directory (the registry search tool);
   - the user's own installed skills (the skill list);
   - **sites and libraries**: pre-built component collections and blocks, dashboard and admin templates, design and UX reference galleries (real app screens and flows), AI prototype sites, design systems, icon and font sets, assets.
3b. **Sweep the sites of ready-made parts.** For every project with screens, go to the component, animation, interface and dashboard sites listed in `system/catalogue.md` and look at what they offer for this project: the live demos, the parts, the motion, the colour and texture ideas. Record what you found there. A scouting pass that skipped this sweep is not complete.
4. **Classify and review each candidate** that is not already approved. The classes: **Connected** (working now), **Directory** (in the Claude connector directory), **Vendor** (published by the tool's own maker, but not in the directory), **Third party** (made by someone else: community servers, hosted generators, other people's templates and packages). Use the `hive-review` skill for every Vendor and Third party tool, and for any hosted generator. For a Directory connector, note what it can read and change. For sites and libraries note the licence, the last update, and how it would be used (copy code, take ideas, or compare).
5. **Design direction (interface projects).** Pick one main visual idea and at most one supporting idea. Check it for contrast, reduced motion and phone performance, and against generic, template-looking design. Use the design skills the user has installed for references, direction and polish, and say which ones you used. Prefer live, clickable prototypes to pictures; label a static picture as a sketch, and mark phone speed "not measured" when it was not.
6. **Make the shortlist.** Every tool on it is either reviewed (show the result) or marked "review needed before use"; never leave it silent. One table. For each tool or site: what it is for in this project; source class; review result; licence; how it would be installed or used; scope (this project only, where possible); the secret it needs (the name only, never a value); the effect on chat cost; alternatives considered; the acceptance test to run.
7. **Show it and ask.** Use short questions with the content inside the question, so it reads on a phone. The user approves, changes or rejects each part. Show the design options the same way.
8. **Save.** Write or update the project profile from the template (`~/hive-mind/core/templates/project-profile.md`) as `~/hive-mind/projects/<project>/profile.md`. Update `system/catalogue.md` (create it if missing): new finds, rejected tools with the reason, and lessons. Say `Saved: ...` in one line.
9. **Stop.** Installs are separate approved steps when building starts, each with a backup and a way back. Say so.

## Rounds

The first pass is a baseline. After the user sees it, ask what to change, then run another round. Each round tries clearly different approaches, connectors, websites and design directions from the last, learns from what the user liked and rejected, and stays inside its own budget. Keep a short "what the user likes" line in the project profile. Stop when the user is happy.

## A bolder push

After each design round, offer a bolder, richer, more layered version as a separate step. Run it only when the person asks.

## Rules

- Official and directory connectors are fine to use. Anything else is reviewed first, the findings are shown, and the user authorises.
- Anything copied from a library, template or prototype site is checked for licence, accessibility and security before it enters a project, and its origin is noted.
- No secrets in notes, searches or the shortlist.
- Be honest about sources: most roundups have their own interests. Mark anything not checked on the maker's own page as unverified.
