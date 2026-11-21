# Registry: skills, connectors, rules and preferences

Made from system/registry.json on 2026-11-20. Do not edit this page; say what to add, remove or change and it is done in the list.

In short: 38 skills (19 in use, 0 installed but not used yet, 19 named but not installed), 11 connectors and tools, 15 rules (13 held by a check, 2 text only), 4 preferences.

## Skills

Skills are packaged instructions Claude loads for a kind of task.

### Coding

| Name | State | From | Review | What it is for |
| --- | --- | --- | --- | --- |
| code-review | in use | maker or built in | not recorded | Review the current changes for bugs. Comes built into Claude Code, if you use that. Not from this folder; nothing was copied here. |
| engineering:code-review | named, not installed | plugin | not recorded | Review code changes for mistakes and risks. Comes with Claude through its plugins, not from this folder. Nothing was copied here; its licence is not recorded in this notebook. Ask Claude to add it, and say yes to the install. |
| engineering:debug | named, not installed | plugin | not recorded | Find why something breaks, step by step. Comes with Claude through its plugins, not from this folder. Nothing was copied here; its licence is not recorded in this notebook. Ask Claude to add it, and say yes to the install. |
| engineering:deploy-checklist | named, not installed | plugin | not recorded | A check to go through before something is released. |
| engineering:documentation | named, not installed | plugin | not recorded | Write and keep up technical documentation: guides, runbooks, onboarding pages. |
| engineering:system-design | named, not installed | plugin | not recorded | Design a system, a service or an API, with the trade-offs said out loud. |
| engineering:testing-strategy | named, not installed | plugin | not recorded | Plan which tests prove that something works. Comes with Claude through its plugins, not from this folder. Nothing was copied here; its licence is not recorded in this notebook. Ask Claude to add it, and say yes to the install. |
| hive-verify | in use | yours | reviewed not-applicable | Prove a change works by walking the real thing as a person would, before and after, and report PASS, FAIL or NOTHING PROVEN. |
| run | named, not installed | maker or built in | not recorded | Start this project's app and see a change working in it. Comes built into Claude Code. |
| security-review | in use | maker or built in | not recorded | Review the pending changes for security problems. Comes built into Claude Code, if you use that. Not from this folder; nothing was copied here. |
| simplify | in use | maker or built in | not recorded | Tidy changed code for reuse and clarity. Comes built into Claude Code, if you use that. Not from this folder; nothing was copied here. |

### Data

| Name | State | From | Review | What it is for |
| --- | --- | --- | --- | --- |
| data:analyze | named, not installed | plugin | not recorded | Answer a question from data: quick lookups up to a full analysis. |
| data:build-dashboard | named, not installed | plugin | not recorded | Build a page of charts and numbers you can read at a glance. |

### Design

| Name | State | From | Review | What it is for |
| --- | --- | --- | --- | --- |
| dataviz | named, not installed | plugin | not recorded | Draw charts and dashboards that read clearly and look like one system. |

### Documents

| Name | State | From | Review | What it is for |
| --- | --- | --- | --- | --- |
| anthropic-skills:docs | named, not installed | plugin | not recorded | Write documents you can share, comment on and edit. Comes with Claude through its plugins, not from this folder. Nothing was copied here; its licence is not recorded in this notebook. Ask Claude to add it, and say yes to the install. |
| anthropic-skills:docx | named, not installed | plugin | not recorded | Make and change Word files. Comes with Claude through its plugins, not from this folder. Nothing was copied here; its licence is not recorded in this notebook. Ask Claude to add it, and say yes to the install. |
| anthropic-skills:pdf | named, not installed | plugin | not recorded | Read, fill, merge and make PDF files. Comes with Claude through its plugins, not from this folder. Nothing was copied here; its licence is not recorded in this notebook. Ask Claude to add it, and say yes to the install. |
| anthropic-skills:pptx | named, not installed | plugin | not recorded | Make and change slide decks as PowerPoint files. Comes with Claude through its plugins, not from this folder. Nothing was copied here; its licence is not recorded in this notebook. Ask Claude to add it, and say yes to the install. |
| anthropic-skills:xlsx | named, not installed | plugin | not recorded | Make and change spreadsheets. Comes with Claude through its plugins, not from this folder. Nothing was copied here; its licence is not recorded in this notebook. Ask Claude to add it, and say yes to the install. |

### General

| Name | State | From | Review | What it is for |
| --- | --- | --- | --- | --- |
| hive-doctor | in use | yours | not recorded |  |
| hive-help | in use | yours | not recorded |  |
| hive-sitrep | in use | yours | not recorded |  |

### Organising

| Name | State | From | Review | What it is for |
| --- | --- | --- | --- | --- |
| anthropic-skills:morning | named, not installed | plugin | not recorded | Show a short brief of your day as a page. Comes with the Claude app. |
| hive-add | in use | yours | reviewed not-applicable | Add, change or remove a skill, connector, rule (protocol) or preference from one sentence of the person. |
| hive-capture | in use | yours | reviewed not-applicable | Save new rules, decisions and lessons to the Hive Mind notebook the moment they appear. |
| hive-close | in use | yours | reviewed not-applicable | Close a chat properly. |
| hive-compact | in use | yours | reviewed not-applicable | Make a long conversation safe to shorten. |
| hive-gates | in use | yours | reviewed not-applicable | The Hive Mind gates - what each one stops, how to satisfy it, how to switch them off and on, how to change a check's mode, how to read their log. |
| hive-project | in use | yours | reviewed not-applicable | Set up a new project from one sentence. |
| hive-setup | in use | yours | reviewed not-applicable | The first conversation of a new Hive Mind. |
| hive-start | in use | yours | reviewed not-applicable | Re-run the Hive Mind start at any time. |
| productivity:memory-management | named, not installed | plugin | not recorded | Keep what Claude should remember about you and your work. Comes with Claude through its plugins, not from this folder. Nothing was copied here; its licence is not recorded in this notebook. Ask Claude to add it, and say yes to the install. |
| productivity:task-management | named, not installed | plugin | not recorded | Keep a task list. Comes with Claude through its plugins, not from this folder. Nothing was copied here; its licence is not recorded in this notebook. Ask Claude to add it, and say yes to the install. |

### Research

| Name | State | From | Review | What it is for |
| --- | --- | --- | --- | --- |
| anthropic-skills:deep-research | named, not installed | plugin | not recorded | A long, sourced research report on a question. Comes with Claude through its plugins, not from this folder. Nothing was copied here; its licence is not recorded in this notebook. Ask Claude to add it, and say yes to the install. |
| hive-intake | in use | yours | reviewed not-applicable | The front door for everything the user sends to keep - a link, a file, a PDF, a screenshot, a list of sites, a video. |
| hive-radar | in use | yours | reviewed not-applicable | Once a week, look outside for new skills, tools, connectors and better ways of working, give each a first safety read, and bring at most three ideas, each waiting for yes, not now or never. |
| hive-review | in use | yours | reviewed not-applicable | Review a tool, server or hosted generator that is not an official or directory connector, with a 10-point safety check, and show the findings so the user can de |
| hive-scout | in use | yours | reviewed not-applicable | Scout for the best tools, connectors, components, libraries, templates and design references before a project's plan, review them, and suggest one shortlist. |

## Connectors and tools

Connectors and tools are outside services Claude can reach.

### Business

| Name | State | From | Review | What it is for |
| --- | --- | --- | --- | --- |
| shopify | named, not installed | Claude directory | safety review still needed | Run a Shopify shop: products, orders, stock. |
| stripe | named, not installed | plugin | safety review still needed | Payments and billing. Use test keys only until you decide otherwise (rule 2). |

### Coding

| Name | State | From | Review | What it is for |
| --- | --- | --- | --- | --- |
| github | named, not installed | plugin | not recorded | Read and work with your code repositories. |
| playwright | named, not installed | plugin | not recorded | Open a page in a real browser to check that it works. A Claude plugin, not from this folder. Ask Claude to add it, and say yes first. |
| vercel | named, not installed | Claude directory | official | Put a website online, and read its logs. In the Claude connector directory (official). Not connected: connect it only when you want it, and say yes first. |

### Design

| Name | State | From | Review | What it is for |
| --- | --- | --- | --- | --- |
| canva | named, not installed | Claude directory | official | Make designs on your brand. In the Claude connector directory (official). Not connected: connect it only when you want it, and say yes first. |
| figma | named, not installed | Claude directory | official | Read design files and components. In the Claude connector directory. |
| whimsical | named, not installed | Claude directory | official | Draw wireframes and flowcharts. In the Claude connector directory (official). Not connected: connect it only when you want it, and say yes first. |

### Organising

| Name | State | From | Review | What it is for |
| --- | --- | --- | --- | --- |
| calendar | named, not installed | Claude directory | official | Read and plan your calendar. In the Claude connector directory. |
| drive | named, not installed | Claude directory | official | Find and read your files in Google Drive. In the Claude connector directory. |
| gmail | named, not installed | Claude directory | official | Read and draft your mail; nothing is sent without your yes. In the Claude connector directory. |

## Protocols

Protocols are the always-rules. Each says what holds it.

- **rule-1**: Ask first before anything public, anything that leaves the computer, deleting, overwriting, installing, connecting, or changing these rules. Held by: yes check (warns).
- **rule-10**: Outside tools are reviewed first. (text only: nothing checks this yet)
- **rule-11**: Show the progress map (steps in a row with a marker) in every reply that reports progress or asks for a decision. Held by: reply check: checkProgressMap (core/gates/gates.mjs).
- **rule-12**: The strongest model plans and reviews; the smallest model that does the job well does the rest. Held by: helper model check (refuses).
- **rule-13**: Precedents first. Held by: scout demanded before design (refuses).
- **rule-14**: Use everything that fits. Held by: helper skills check (refuses); used-line check (warns).
- **rule-15**: Keep every end in step. Held by: ends check (system/ends-check.mjs).
- **rule-2**: Money is yours. Held by: yes check, paid tools (warns).
- **rule-3**: Research and planning need no yes. (text only: nothing checks this yet)
- **rule-4**: Understand first. Held by: design check (refuses); stage check (warns).
- **rule-5**: Small steps, with proof. Held by: done-without-proof check (warns).
- **rule-6**: Claude speaks to you in plain, simple language, always, the way one talks to a friend: whole sentences that explain why, no labels, no inside words. Held by: reply check (refuses: length, file names, code).
- **rule-7**: Never ask twice. Held by: front door (refuses); correction and preference checks (warn).
- **rule-8**: Stale is dangerous. Held by: ends check: old phrases, notes that disagree.
- **rule-9**: No secrets in notes. Held by: privacy check at every save (core/guard/privacy-guard.mjs).

## Preferences

Preferences are things you said you always or never want.

- **ask-first-public-paid**: Ask me first before anything public, anything that leaves this computer, or anything that costs money. (text only: nothing checks this yet)
- **explain-then-try**: Explain a new idea first, then let me try it myself. (text only: nothing checks this yet)
- **plain-speech**: Speak plainly: everyday words, short sentences, no jargon. (text only: nothing checks this yet)
- **short-reports**: Keep reports short: what is done, what I must do, and the one question. (text only: nothing checks this yet)

## Sets

Starting sets are ready-made groups of skills, connectors and habits, each put in place in one step. Every set also holds the rules, the helpers and the three starting habits.

- **builder**: For code and websites: review, debugging, tests, documents, design and release checks. Full holds: engineering:code-review, engineering:debug, engineering:testing-strategy, engineering:documentation, engineering:system-design, engineering:deploy-checklist, security-review, simplify, run, github, playwright, vercel. Light: engineering:code-review, security-review, simplify, run. Standard: engineering:code-review, engineering:debug, engineering:testing-strategy, engineering:documentation, security-review, simplify, run, github.
- **designer**: For screens, brands and drawings. Full holds: anthropic-skills:docs, simplify, canva, figma, whimsical, playwright. Light: anthropic-skills:docs, simplify, figma. Standard: anthropic-skills:docs, simplify, canva, figma, playwright.
- **everyday** (the default): For anyone: tasks, notes, documents, and your calendar, mail and files. Full holds: productivity:task-management, productivity:memory-management, anthropic-skills:docs, anthropic-skills:pdf, anthropic-skills:morning, simplify, calendar, gmail, drive. Light: productivity:task-management, anthropic-skills:docs, simplify, calendar. Standard: productivity:task-management, productivity:memory-management, anthropic-skills:docs, anthropic-skills:pdf, simplify, calendar, gmail.
- **small-business**: For a shop or a one-person company: sheets, documents, slides, research, numbers, mail and calendar (a shop and payments come later, after their safety review). Full holds: anthropic-skills:xlsx, anthropic-skills:docx, anthropic-skills:pptx, anthropic-skills:deep-research, data:analyze, data:build-dashboard, simplify, gmail, calendar. Light: anthropic-skills:xlsx, anthropic-skills:docx, simplify, gmail. Standard: anthropic-skills:xlsx, anthropic-skills:docx, anthropic-skills:pptx, data:analyze, simplify, gmail, calendar.
- **student**: For courses, deadlines and papers: the everyday skills plus research and slides. Full holds: productivity:task-management, productivity:memory-management, anthropic-skills:docs, anthropic-skills:pdf, anthropic-skills:morning, anthropic-skills:deep-research, anthropic-skills:pptx, anthropic-skills:docx, simplify, drive, calendar, explain-then-try. Light: productivity:task-management, anthropic-skills:docs, simplify, explain-then-try. Standard: productivity:task-management, anthropic-skills:docs, anthropic-skills:pdf, anthropic-skills:pptx, anthropic-skills:docx, simplify, drive, calendar, explain-then-try.
