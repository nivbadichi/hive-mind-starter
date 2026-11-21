---
name: hive-project
description: Set up a new project from one sentence. Use when the person says set up X as a project, start a project for X, add a project, or new project.
---

# New project: one sentence in, a project that passes the health check

The program is `node core/engine/project.mjs new-project`. It creates `projects/<name>/state.md` and `projects/<name>/profile.md` and never touches a project folder that exists. Stages come from this fixed list: discover, define, plan, design, build, verify, release, maintain, close, paused, not set up. A new project starts at `discover`.

## 1. Ask at most three short questions

Ask only what their sentence left open, one topic per question, the answer choices inside the question:
1. What is it for? (one line; skip when their sentence says it)
2. Does it have a folder on the computer? (a path, or "none")
3. Is it personal or for an employer? (an employer project keeps its notes high level: rule 9)

Skip all three when the sentence answers them. Everything else is decided later, in the define and plan stages.

## 2. Create it

`node core/engine/project.mjs new-project --name "<name>" --purpose "<one line>" [--folder "<path>"] [--kind personal|employer]`

When it says the project already exists, stop and tell them; the existing folder stays as it is.

## 3. Check it

The program prints the health check's project lines. Done when every line starts with `OK|`.

Tell them in two lines: what was created, and the first next step (confirm what the project is for and who it is for). When the project will have a screen, say that the design direction note and `hive-scout` come before any design work.

Save the new project with `hive-capture`, and say `Saved: ...` in one line.

## 4. A project with code runs in Docker

Not tried yet in a newcomer's copy: written from the main Hive Mind's rule, never walked by a new person.

When the project holds code (a website, an app, a program), where it runs is settled at the start, the same day: in Docker, sealed off. Also when the person says "run this project in Docker".

1. Check: `docker --version`. Missing: say in one line what Docker is for ("it runs the project's code in a sealed box, so a mistake cannot reach your files"), and install it only after their yes: on Windows Docker Desktop (it needs WSL 2: `wsl --status`), on a Mac Docker Desktop, on Linux Docker Engine. Docker's terms are theirs to accept; leave its usage data off and its remote access off.
2. In the project's folder, write a `Dockerfile` with an exact base version (never `latest`), an ordinary user (never root), and a `.dockerignore` that keeps out every secret, `.env` file and private note. Ports only on `127.0.0.1`.
3. Build and test inside it: `docker build -t <project>:test .`, then `docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges <project>:test`. The first build downloads the base box from Docker's store: ask first, once.
4. Never push an image (`docker push`, `docker login`, `--push`) and never use a remote Docker host, `--privileged`, `--network host` or a mount of the home folder: each needs its own yes, and the default answer is no.
5. Write one line in the project's `state.md`: `runs_in: docker (sealed: no network, ordinary user)`, or `runs_in: not in docker yet: Docker is not installed here`.

Done when the test ran inside the container, or the person knows in one line why it did not (and the same tests ran without it, said as "not run in Docker").
