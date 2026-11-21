# The standard kit: what every project is built with

A starting kit: change any default to your own choice, and say why in the decisions note. When a project is designed and planned, walk this list and decide, for each need, whether the project has it. Write the answer in the project's profile: used, not needed (with the reason), or later. A project uses only what it needs; the kit is the default answer, so the choice is not made from scratch each time.

**The point:** when Hive Mind is active in a project, it builds that project a stack. Prices are left out of this note on purpose; a plan's limits are noted only where they change how something is built.

| Need | Default | When a project needs it | Known limits and notes |
| --- | --- | --- | --- |
| Building | Claude | Always | Your Claude plan. Strongest model plans and reviews; smaller models do bounded work. |
| Where code runs | Docker | Anything with code, from its first day | Every project runs in a container, a helper tries its changes in a sealed one (no network, nothing of your computer mounted in), and the same image runs the tests on your computer and on GitHub. Images are built and run on your computer only; nothing is pushed anywhere. Whether Docker is on your computer: Claude checks with `docker --version` (reading only). Installing it is your yes. Not tried yet in this copy. |
| Code and history | GitHub | Always | Private by default. Not connected until you say so. |
| Hosting and deploys | Vercel | Anything with a web front | Not connected. Checked 2026-11-14: the free plan protects a site with Vercel sign-in. Not confirmed: whether the free plan allows commercial use. |
| Database, storage, back end | Supabase | Data that must persist or be shared | Checked 2026-11-14: the free plan pauses a project after a week without use, so a live project must be kept awake or moved up. Not connected. |
| Sign-in for users | Clerk | Other people log in | Not needed for a site only you open (Vercel sign-in covers that). Not connected. Supabase also offers sign-in: choose one per project, not both. |
| Payments | Stripe | The project takes money | Test mode only until you say go live. Can move money: every live step is yours. |
| Sending email | Resend | The app emails people | Sending is outward: needs your yes per project. Not connected. |
| Domain name | Namecheap | A public project with its own name | You buy it. |
| DNS and protection | Cloudflare | A project with its own domain | Not connected. |
| Product analytics | PostHog | Real users, and we need to know what they do | Privacy: say so in the project's privacy page. Not connected. |
| Error tracking | Sentry | Anything live | Checked 2026-11-14: a free plan for one user exists. Not connected. |
| Fast cache and queues | Upstash (Redis) | Rate limits, queues, short-lived state | Only when a real need shows. Not connected. |
| Memory search for AI | Pinecone (vector database) | The app searches text by meaning | Only when plain search is not enough. Not connected. |

## How the kit is used, by stage

- **Discover and define:** name which needs the project has. Scouting may propose something better than a default; it must say why.
- **Plan:** each chosen service becomes a step: review it (official and directory connectors are fine; anything else gets the 10-point review), connect it with your yes, and prove it with one small real task.
- **Design:** the data model, sign-in, payments and monitoring are designed with the chosen services, not added after.
- **Build:** the project runs in its container from the first line of code, and helpers try changes in a sealed one (no network, no home folder). Secrets live in environment settings or a sign-in, never in notes, code or an image. Test mode first.
- **Release:** error tracking and analytics are on before the first real user. A privacy page says what is collected.
- **Maintain:** each service's health and limits are watched, so a project never stops because a plan ran out.

## The full checklist: everything a real product needs

The table above is the kit of services. The table below is the whole list: the services and also the plan, the design, the tests, the legal pages, the support and the upkeep, because a product that has a database but no way back, or a site with no privacy page, is not ready.

**How it is used.** Every project that is set up and not paused keeps its own copy of this list in `projects/<name>/stack.md`, made by `node core/engine/stack.mjs new <project>`. Each line there is marked one of four ways:

- **used**: it is there. The line says what, and where it lives.
- **not needed**: with the reason. A line with no reason fails the health check.
- **missing**: it is needed and not there. A missing line that is due at the project's stage fails the health check, by name, until it is dealt with.
- **not yet**: it will be needed from a later stage. The line says from which stage. When the project reaches that stage, the line must become used or missing.

`node core/engine/stack.mjs check` checks every project's list. `node core/engine/stack.mjs next <project>` shows the three most important missing lines with how to use each. `hive-scout` reads the project's note at the start and updates it at the end.

**How to read the table.** *For* says which projects need the line: `all`, or one or more kinds: `code` (it has code), `web` (it has screens in a browser), `data` (data must persist), `users` (other people log in), `money` (it takes money), `email` (it emails people), `public` (strangers can see it), `ai` (the product itself uses an AI model), `private` (a page only you open), `employer` (an employer project). Several kinds mean any one of them is enough. *From* is the earliest stage at which the line is due: discover, define, plan, design, build, verify, release, maintain or close. *Default* is only what you chose in the kit above, or what Hive Mind itself provides; where you have not chosen, it says "no default yet: scout it", and `hive-scout` proposes one for you to approve. Nothing is signed up, connected or paid for by the checklist: every account, payment and live step in *How to use it* is yours.

**Where the groups came from (searched 2026-11-18).** The twelve-factor app (codebase, settings kept outside the code, the build then release then run split, logs): groups 2, 12 and 17. Production-readiness checklists (watching it, a way back, capacity, who owns it, runbooks): groups 12, 17, 19 and 21. Vercel's own production checklist (operations, security, reliability, speed, cost): groups 12, 15 and 18. The OWASP application security standard: the idea of levels (a baseline, then stricter ones) became the *From* column and the `level` line; its chapter headings were not returned by the search, so the security group is written from the common items. Public SaaS launch checklists (legal pages before any data comes in, analytics, support, the payment flow tested, email that is proven not to be spam): groups 9, 10, 16 and 20. The lines are written in our own words.

**The layers added on 2026-11-20.** The first list was built from services and pages, not from the layers a running program passes through, so the first layer of all, where the code runs and whether it is sealed off, had no line. Twelve lines were added, each marked *added 2026-11-20* and each saying when a project may skip it. Taken from: the twelve-factor app's points II (dependencies declared and isolated), V (build, release, run kept apart), IX (start fast, stop cleanly) and X (the same on your computer as live); production-readiness checklists (a health check, a runbook, a check right after each release, data changes with a way back); Docker's own advice for images (a list of what may enter, an exact base version, no secrets in the image, an ordinary user); and the dev container idea (the whole working place defined in a file).

| Id | Line | What it is | For | From | Default | How to use it |
| --- | --- | --- | --- | --- | --- | --- |
| | **1. The idea and the plan** | | | | | |
| purpose | What it is for and who it is for | One or two plain lines saying what the project does and who uses it. | all | discover | Hive Mind (the project's note) | Claude asks you short questions and writes your answer in the project note. You answer in your own words. |
| plan | A plan you approved | The steps in order, each with what done looks like. Nothing is built before you say yes. | all | plan | Hive Mind (a plan note) | Claude writes the plan and shows it as short questions. You say yes, change it or say no. |
| done | A definition of done | A short list of what must be true before the project, or a slice of it, counts as finished. | all | define | Hive Mind (the project's note) | Claude proposes the list and you approve or change it. |
| | **2. Code and history** | | | | | |
| repo | Code kept in a repository | All the code and notes in one place that remembers every change. | code | plan | GitHub, private | Claude creates it and connects it after your yes. The GitHub account is yours. |
| history | Saved in small steps | Each change saved with a clear note, so any step can be undone. | code | build | GitHub | Claude saves in small steps when you ask it to. Pushing to GitHub is your yes each time. |
| | **3. Where it runs and how it is built (containers, tool versions, locks, the build)** | | | | | |
| container | Runs in a container from the first day | Added 2026-11-20. The project's code runs inside a container defined in a file kept with the code, so it runs the same on any computer and cannot reach the rest of your computer. Development, the tests and the production build all run in it. | code | build | Docker (the official image of the project's language at an exact version; the container files live next to the code) | Claude writes the container files and the exact commands, and tries them. Installing Docker on your computer is your yes, once. Nothing is pushed to an image registry. Not tried yet in this copy. Skip it only when: the project has no code that runs (notes only), said in the line. |
| sandbox | Helpers try changes in a sealed container | Added 2026-11-20. A helper builds and tests its change inside a container with no network, no access to your home folder and only the project's files copied in, so a mistake cannot touch your computer or leave it. | code | build | Docker (run with no network and as an ordinary user) | Each helper's brief names the commands to use. Nothing for you to do. Not tried yet in this copy. Skip it only when: the helper only reads or writes notes and runs nothing. |
| toolchain | Tool versions pinned | Added 2026-11-20. The language and tool versions are written once, in the container file, so every computer and every helper uses the same ones. | code | build | Docker (the image's exact version, never "latest") | Claude pins the version and says when to move it up. Skip it only when: the project has no code. |
| lockfile | Dependencies locked | Added 2026-11-20. Every library at an exact version in a lock file that is saved with the code, and installed from the lock, never resolved afresh. | code | build | The language's own lock file (for Node: package-lock.json, installed with npm ci) | Claude keeps the lock saved and installs only from it. A new library is your yes. Skip it only when: the project uses no libraries. |
| build | One build, the same each time | Added 2026-11-20. One command builds it, inside the container; the thing that is built is the thing that is tested and released (build, then release, then run). | code | build | The project's own build script, run in the container | Claude writes the one command and runs it in the container before any release. Skip it only when: nothing is built (plain notes). |
| parity | The same container on your computer and on GitHub | Added 2026-11-20. The checks that run on GitHub use the same container image as your computer, so "it passes here" means it passes there. | code | build | Docker, with GitHub Actions running the same container file | Claude writes the workflow file. Turning it on is a push, your yes. Skip it only when: the project is never checked on GitHub, said in the line. |
| | **4. Building and models** | | | | | |
| builder | Who builds, and with which model | The builder is named, and the strongest model plans and reviews while smaller ones do bounded work. | all | discover | Claude | Nothing to set up. Each report says which model did what. |
| parts-plan | Skills, connectors and ready parts chosen first | Before anything is built by hand, the work is matched to what already exists, and the choice is written down. | all | plan | Hive Mind (hive-scout and the registry) | Claude runs the scouting and shows one shortlist. You approve each install or connection. |
| ai-use | AI inside the product | When the product itself calls an AI model: which model, where its key lives, and a spending cap. | ai | design | no default yet: scout it | Claude proposes the model and a cap. You create the account and set the cap yourself. |
| ai-search | Search by meaning | Finding text by what it means, not by the exact words typed. | ai | design | Pinecone | Only when plain search is not enough. Claude shows why first. You create the account. |
| | **5. Design (direction, parts, accessibility, phone)** | | | | | |
| direction | A design direction note | The look decided before any screen is built: the main idea, why it fits, and the checks. | web | design | Hive Mind (a design direction note) | Claude scouts and shows options as short questions. You choose. The design gate refuses screens without it. |
| parts | Ready-made parts and their licences | The components, fonts and icons used, each with its licence written down. | web | design | Hive Mind (a parts list in the project's notes) | Claude picks proven parts first and records each one. You approve anything new. |
| access | Usable by everyone | Readable contrast, works by keyboard, respects reduced motion, works with a screen reader. | web | build | no default yet: scout it | Claude checks with the web-design-guidelines skill and fixes what it finds. You only try it. |
| phone | Works on a phone | Sizes, touch and speed checked on a small screen. | web | build | no default yet: scout it | Claude builds for the phone first and checks at phone width. You look on your own phone. |
| worst-case | The worst content still looks right | Long names, empty lists, huge numbers and missing data do not break the screen. | web | verify | no default yet: scout it | Claude runs the break-ui check with made-up bad data and fixes what breaks. You look at the result. |
| | **6. The front (the screens)** | | | | | |
| front | The screens work | The pages people see are built and run. | web | build | no default yet: scout it | Claude builds in slices you approved and shows each one. You try it and say what is wrong. |
| friendly-errors | Friendly pages for lost and broken | A clear page when a link is wrong or something fails, never a blank or a code. | web | build | no default yet: scout it | Claude adds them. Nothing for you to do. |
| share | Title, description, picture and icon | What shows in the browser tab and when the link is shared in a message. | public | release | no default yet: scout it | Claude adds them. You look at the shared preview. |
| speed | Speed measured | How fast it loads on a phone, as a number, not a feeling. | web | verify | no default yet: scout it | Claude measures and reports the numbers. Nothing for you to do. |
| | **7. Back end and data (database, storage, backups, made-up data, changes of shape)** | | | | | |
| model | Data planned on paper first | What is stored, how the pieces link, and who may read each part, written before it is built. | data | design | Hive Mind (a design note) | Claude drafts it as a short picture and words. You approve it. |
| database | A database | The place where data that must last is kept. | data | design | Supabase | Claude connects it after your yes. You create the account. On the free plan a project pauses after a week unused, so a live project must be kept awake or moved up. |
| files | Storage for uploaded files | The place where pictures and documents people add are kept. | data | design | Supabase | Same account as the database. Claude sets it up after your yes. |
| limits | Limits and short-lived memory | Stopping one visitor from hammering the service, and remembering small things for a short time. | data | build | Upstash | Only when a real need shows. Claude says why first. You create the account. |
| backups | A copy kept somewhere else | A copy of the data outside its main place, and one real test of getting it back. | data | release | no default yet: scout it | Claude sets it up and tests a restore. You approve any cost. |
| api | The back end checks who asks | Every request is checked for who is asking and what they may do, and errors do not leak details. | data | build | no default yet: scout it | Claude builds and tests it with two accounts. Nothing for you to do. |
| test-data | Made-up data to build and test with | Added 2026-11-20. A made-up set of data, shaped like the real one, that development, the tests and every container use. The real data is never copied into a test, a container or a public build. | data | build | Hive Mind (a made-up example file kept with the code) | Claude writes it and keeps it in the real data's shape. Nothing for you to do. Skip it only when: the project keeps no data. |
| migrations | Changes to the shape of the data, with a way back | Added 2026-11-20. Each change to how the data is stored is a saved file, tried on a copy first, with the steps to undo it. | data | build | Supabase (its migration files), when the database is used | Claude writes each change and its undo and tries both on a copy. Applying one to live data is your yes. Skip it only when: there is no database yet; mark it not yet with the stage. |
| | **8. Sign-in** | | | | | |
| signin | Sign-in for people | Other people log in with their own account. | users | design | Clerk (Supabase also offers sign-in: choose one per project) | Claude connects it after your yes. You create the account. |
| roles | Who may see what | Each kind of person sees only what they should: admin, helper, guest. | users | design | Hive Mind (a design note) | Claude writes the roles as a small table and tests with two accounts. You approve the table. |
| locked | Private pages are locked | A page only you open is protected from everyone else. | private | build | Vercel sign-in | Claude turns it on and tries to open the page from outside. You confirm it asks for sign-in. |
| | **9. Payments** | | | | | |
| payments | Taking payments | Money from customers goes through a payment service. | money | design | Stripe | Test mode only until you say go live. Every live step is yours: the account, the bank details, the switch. |
| money-flow | Receipts, refunds and tax | What the customer gets after paying, how a refund works, and who deals with tax. | money | release | no default yet: scout it | Claude lists the questions. You decide the rules, and a qualified person checks the tax side. |
| money-test | The whole payment flow tested | Paying, failing and refunding, in test mode, before any real money. | money | verify | Stripe (test mode) | Claude runs the test payments and shows the result. You watch it. |
| | **10. Email and messages** | | | | | |
| email | Sending email | The product emails people: welcome, receipts, invitations. | email | design | Resend | Sending is outward, so it needs your yes per project. You create the account. |
| email-trust | Email that arrives, not in spam | The sending address is proven to the world with three records on the domain (SPF, DKIM, DMARC). | email | release | Cloudflare (DNS) | Claude gives you the exact records. You add them, or approve Claude adding them. |
| optout | A way to stop the emails | Every message has a clear unsubscribe or a setting. | email | release | no default yet: scout it | Claude adds it and tests it. Nothing for you to do. |
| | **11. The address (domain, DNS, certificate)** | | | | | |
| domain | Its own web address | A name people can type. | public | release | Namecheap | You buy it. Claude never pays. Connecting it to a site is a publish and waits for your yes. |
| dns | DNS and protection | The records that point the name at the site, and a shield against abuse. | public | release | Cloudflare | Claude gives the records. You approve any change. The account is yours. |
| tls | The secure padlock | Traffic between the visitor and the site is encrypted (https). | web | release | no default yet: scout it | The host usually does it once the domain is connected. Claude checks the padlock and shows you. |
| | **12. Hosting and releases (previews, a way back)** | | | | | |
| hosting | Hosting | The place where the site runs. | web | build | Vercel | Claude connects it after your yes. You create the account. On the free plan a site is protected by Vercel sign-in, and whether the free plan allows commercial use is not confirmed. |
| previews | A preview before live | Every change can be seen at a private link before it is public. | web | build | Vercel (previews) | Claude puts the change on a preview. You look and say go. |
| way-back | A way back | Putting the last good version back fast, tried once before the first real user. | web | release | Vercel (earlier versions) | Claude writes the steps and tries them once, with your yes. |
| settings | Settings kept outside the code | Keys and settings are different for test and for live, and sit in environment settings. | code | build | Vercel (environment settings) | Claude names the settings and where each lives. You paste secret values yourself on the service's own page, never in chat. |
| release-notes | A record of each release | One line each time something went live: when, what, and the address. | public | release | Hive Mind (a releases note) | Claude's publish step writes it. Nothing for you to do. |
| | **13. Tests (which kinds)** | | | | | |
| t-unit | Tests of the logic | Small tests of the rules inside the code. | code | build | no default yet: scout it | Claude writes them with the code and runs them. Nothing for you to do. |
| t-joined | Tests of the parts together | The screens, the back end and the data tested as one. | data | verify | no default yet: scout it | Claude writes and runs them against test data only. |
| t-browser | Click-through in a real browser | A real browser walks the main paths and takes pictures. | web | verify | no default yet: scout it | Claude runs it with the playwright-cli skill and shows the pictures. You look. |
| t-load | Many visitors at once | A check that it holds up when many people arrive together. | public | release | no default yet: scout it | Claude runs it against a preview only, never against someone else's service. |
| smoke | A quick check right after each release | Added 2026-11-20. A few steps walked against the live address right after it goes up (the page opens, the main path works), with the way back ready if one fails. | web | release | Hive Mind (the playwright-cli skill, reading only) | Claude runs it after each release and says what it saw. Nothing for you to do. Skip it only when: nothing is released to an address. |
| | **14. Quality gates and review** | | | | | |
| review | A second look before release | A separate reader reviews the code and the security. | code | verify | no default yet: scout it | Claude runs the code-review and security-review skills in a fresh helper and shows what they found. |
| auto-check | Checks that run by themselves | Tests and lint run on every change without anyone remembering. | code | build | no default yet: scout it | Claude sets it up and shows the first run. |
| gates | Hive Mind's gates and health check | The rules held by programs, and the health check green. | all | discover | Hive Mind (the gates and system/check.ps1) | Nothing to set up. A refusal explains itself. |
| proof | Every claim has proof | Every report says what was run, what it printed, and what was not checked. | all | build | Hive Mind (the build brief) | Nothing to set up. A report without proof is sent back. |
| | **15. Security (secrets, the web list, parts, what is built)** | | | | | |
| level | A security level chosen | How strict this project must be: a baseline for ordinary projects, stricter when money, health or many people's data is involved. | all | define | no default yet: scout it | Claude proposes a level and why. You choose. |
| secrets | No secrets in code or notes | Keys live in environment settings. The history was checked once for leaked keys. | code | build | Hive Mind (the privacy check at every save) | Claude keeps keys out and checks the history. You enter secret values yourself on the service's page. |
| websec | The web security list | A web security list for the project, every item done or marked not needed. | web | verify | no default yet: scout it | Claude goes through the list and shows the result. You approve. |
| deps | Parts kept safe and up to date | Libraries updated, unused ones removed, known holes checked. | code | verify | no default yet: scout it | Claude runs the package audit and lists what it found. You approve updates that change behaviour. |
| build-clean | Nothing private in what is built | Added 2026-11-20. The list of files that enter every image or bundle is built and searched: no private notes, no settings or keys file, no real data. Only what is named may go in. | code | build | An ignore file that lists what may enter, and a search of the image's file list | Claude writes the list and searches it before each build. Nothing for you to do. Skip it only when: nothing is built into an image or bundle. |
| | **16. Privacy and legal (the legal pages, what leaves, licences)** | | | | | |
| data-map | What leaves, and to whom | Each service that receives anyone's data, listed in one place. | all | plan | Hive Mind (system/what-leaves.md) | Claude keeps the list. You see it before anything new is connected. |
| privacy | Privacy Policy | A page saying what is collected, why, and who receives it. | public | release | no default yet: scout it | Claude drafts it. A qualified person should read it. The contact address shown is yours to choose. |
| terms | Terms of use | The rules for using the site or product. | public | release | no default yet: scout it | Claude drafts it. A qualified person should read it. |
| cookies | Cookie notice, only if needed | Needed only when the site sets cookies beyond the essential ones. | public | release | no default yet: scout it | Claude checks what the site really sets and says whether a notice is needed. |
| a11y-statement | Accessibility statement | A page saying which standard is followed, the known gaps, and whom to tell. Required by law in some countries. | public | release | no default yet: scout it | Claude drafts it only from tests really done. You say what testing was done. |
| rights | Asking about one's own data | A way for a person to see or delete what is kept about them. | users | release | no default yet: scout it | Claude designs it with the sign-in. You approve the wording. |
| licences | Licences of parts | Every library, font and part, with its licence written down. | code | build | Hive Mind (a parts list in the project's notes) | Claude records each part when it is added. |
| employer-rule | The employer's rule on where things may be kept | What the employer allows to be stored outside its own tools. | employer | define | no default: it is your employer's rule | You ask your employer. Claude writes the answer down, high level only. |
| | **17. Watching it live (errors, uptime, analytics, health)** | | | | | |
| errors | Error tracking | You know when something breaks, with the detail to fix it. | web | release | Sentry | On before the first real user. Claude connects it after your yes. You create the account (a free plan for one user exists). |
| uptime | Told when it is down | Someone is alerted when the site stops answering. | public | release | no default yet: scout it | Claude proposes a service. You create the account and say where the alert goes. |
| analytics | Product analytics | What people actually do, counted without naming them. | public | release | PostHog | The privacy page must say it. Claude connects it after your yes. You create the account. |
| logs | Logs you can read | A record of what the running site did, readable when something goes wrong. | web | release | no default yet: scout it | Claude says where they are and how to read them. |
| health | A page that says it is alive | Added 2026-11-20. A small address that answers "alive" when the site and what it needs are working; the container's own health check and the uptime alert read it. | web | release | A small route in the project, read by the container's health check | Claude adds it and shows it answering. Nothing for you to do. Skip it only when: a plain static page with nothing behind it, where the uptime check reads the home page. |
| | **18. Cost and limits of each plan** | | | | | |
| plan-limits | Each service's plan limits noted | For each service: what the plan allows and what happens at the limit. | all | plan | Hive Mind (the notes in this file) | Claude checks the maker's own page and writes it down. |
| cost | Monthly cost known and approved | The total per month, and every spend approved by you. Claude proposes and never pays. | all | plan | no default yet: scout it | Claude shows the cost per service. You approve each spend and set any cap on the service's own page. |
| | **19. Documentation (README, how to run, how to release, when it breaks)** | | | | | |
| readme | A README | What it is and how to start, in plain words. | code | build | no default yet: scout it | Claude writes it and keeps it in step. |
| run | How to run it | The steps to run it on a fresh computer. | code | build | no default yet: scout it | Claude writes the steps and tries them once. |
| release-how | How to release it | The steps to go live and to go back. | web | release | no default yet: scout it | Claude writes the steps. You approve the first live release. |
| decisions | Why things were chosen | The decisions and the reasons, so a later reader does not redo them. | all | plan | Hive Mind (system/decisions-in-force.md) | Claude records each decision when you make it. |
| user-guide | A plain guide for the people who use it | How to use the product without technical words. | all | release | no default yet: scout it | Claude writes it. You say what is unclear. |
| runbook | What to do when it breaks | Added 2026-11-20. For each likely failure (the site is down, a release went wrong, a service ran out), the first steps, who acts and how to go back. | code | release | Hive Mind (a when-it-breaks note kept with the project) | Claude writes it and tries one step of it once. You read it. Skip it only when: nothing runs for other people. |
| | **20. Support and contact** | | | | | |
| contact | A way to reach you | A contact address or form people can find. | public | release | no default yet: scout it | You choose the address shown. Claude puts it on the site. |
| help | Help text | Short answers to what people will ask first. | public | release | no default yet: scout it | Claude drafts from the first real questions. You approve. |
| | **21. Maintenance (who looks, how often)** | | | | | |
| upkeep | Who looks after it, how often | A named person and a rhythm for checking it. | all | maintain | Hive Mind (the health check and the daily run) | Claude names the rhythm. You confirm who. |
| service-health | Services and their limits watched | Each service's health and plan limits are looked at, so nothing stops because a plan ran out. | all | maintain | Hive Mind (the health check) | Claude lists what to watch. You approve any change of plan. |
| exit | A way to close it down | Exporting the data, cancelling each service, and removing what should go. | all | close | no default yet: scout it | Claude writes the steps when the project nears its end. You approve each cancellation. |
