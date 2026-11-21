---
name: hive-review
description: Review a tool, server or hosted generator that is not an official or directory connector, with a 10-point safety check, and show the findings so the user can decide. Use before any third-party tool or vendor server is used.
---

# Safety review

Do this before any Vendor or Third party tool is used. Never install, run or sign in to it during the review. Look, read, and report. Use the maker's own pages, the code host page and the package page, not only roundups. If a fact cannot be found, write "not checked", never guess.

## The ten checks

For each, give a result: **fine**, **note** or **concern**, with one plain line of evidence.

1. **Who made it.** The maker or company, and whether it is the tool's own maker.
2. **Is it alive.** The date of the last update, open problems, whether it is archived or has a new owner.
3. **Licence.** And whether the licence allows the intended use.
4. **Where it runs and what it sends.** Local or hosted. What data and prompts leave the machine, and to whom.
5. **What it can do.** Read only, or change things, spend money or send messages.
6. **Secrets.** What key or sign-in it needs and how it is stored. It must be an environment variable or a sign-in, never a value in notes or shared files. Note whether a test key or read-only key exists.
7. **Supply chain.** How it is installed (the package name, a recent version, its dependencies), and any known incident.
8. **Exposure to hostile content.** Whether it reads web pages, messages or files that could carry harmful instructions.
9. **Safe first use.** Test mode, sandbox, a dummy project, or read only.
10. **Fit.** Does it really beat what is already there, and is it worth the extra risk.

## Verdict

One of: **OK to authorise**, **authorise with care** (say what care), or **do not use** (say why).

## Show it

Show the ten results and the verdict in short plain lines, with the content inside the question so it reads on a phone. The user decides. Record the review in `~/hive-mind/system/catalogue.md` (create it if missing): date, verdict and the evidence, so it is not redone from zero.

Anything the user declines goes on the rejected list in that note, with the reason.
