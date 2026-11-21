# Your first hour

This page takes you from nothing to a working Hive Mind. You never need to type a command yourself on Windows: Claude types them, and asks you before each one. Every step has one thing to do, what you should see after it, and what to do if something else happens.

The steps were walked on Windows on test folders. On a Mac and on Linux they are written the same way but **not tried yet**; the boxes marked "On a Mac or Linux" say where things differ.

Words that may be new to you are explained where they first appear, and all of them are in [Words we use](words.md).

**If you came from "Start yours" on the Hive Mind site:** its steps page follows this manual. It counts its steps a little differently, because signing up is a step of its own there, but each step asks the same things as here. After steps 3, 5 and 7 below, a box called **Your Hive Mind code** shows how to tell the page what is really done.

---

## Before you start (about 10 minutes)

You need three things. Check each one.

**1. Claude Pro or higher.** If you are not sure which plan you have, look in the Claude app's settings, under your account. The free plan does not include Claude Code, the part of Claude that works with files on your computer, so Hive Mind cannot run on it. Pro, Max, Ultra, Team and Enterprise all work.

**2. The Claude desktop app, signed in.** Download it from [claude.com/download](https://claude.com/download), install it, open it, and sign in. At the top of the window you see tabs; one of them is called **Code**. That is where Hive Mind lives.

> **If this happens:** there is no **Code** tab. Your plan may be the free plan (see 1), or your app may be old: download it again from the same page.

**3. A GitHub account.** GitHub is a website that keeps files online. Your notes are kept there in a private copy that only you can read. If you have no account, go to [github.com/signup](https://github.com/signup), make a free account, and confirm your email address. Write down your GitHub user name (it shows at the top right of GitHub once you are signed in).

That is all. You do **not** need to install anything else by hand: Claude does it with you in step 3.

---

## Step 1. Make your private copy on GitHub (about 3 minutes)

A "private copy" is your own copy of Hive Mind on your GitHub account. It starts empty of notes, and only you can read it.

1. Sign in to GitHub in your web browser.
2. Open Hive Mind's page on GitHub: **https://github.com/nivbadichi/hive-mind-starter**
3. Click the green button **Use this template**, then **Create a new repository**. (A "repository" is GitHub's word for a folder of files kept online.)
4. Under **Owner**, choose your own user name. Under **Repository name**, type `hive-mind`.
5. Choose **Private**. This matters: your notes go into this copy.
6. Click **Create repository**.

**You should see:** a new page whose address is `github.com/<your user name>/hive-mind`, with the word **Private** beside the name. Copy that address from the browser's address bar; you need it in step 3.

> **If this happens:**
> - **There is no "Use this template" button.** You are not signed in, or you are on someone's copy instead of Hive Mind's own page. Sign in and open the address in point 2 again.
> - **You were about to click Fork or Download ZIP.** Do not. A fork of a public page cannot be made private, so your notes could be seen. A ZIP download cannot be saved back to GitHub, so your notes would only live on this computer.
> - **The page says Public.** Open the copy's **Settings**, scroll to the bottom (the "Danger Zone"), click **Change visibility**, and choose **Private**.

---

## Step 2. Open a chat in your home folder (about 2 minutes)

Your "home folder" is the folder with your user name: on Windows `C:\Users\<your name>`, on a Mac `/Users/<your name>`.

1. In the Claude app, open the **Code** tab.
2. Look at the row of small controls **under the box where you type**. The first one chooses where Claude runs: choose **Local** (this computer).
3. The control next to it chooses the folder Claude works in. Click it and choose your home folder.
4. In the same row, the permission mode should be **Manual** (older versions call it "Ask permissions"). Manual means Claude asks you before it changes a file or runs a command. Keep it that way for the first hour.

**You should see:** an empty chat, with your home folder's name in the row under the typing box.

> **If this happens:** the row shows no folder control. You picked a saved environment that already holds its own folders. Choose plain **Local** in the first control instead.

---

## Step 3. Ask Claude to put your copy on this computer (about 10 minutes)

Copy this message, put your own address in the second line, and send it:

```
Put my private Hive Mind copy on this computer.
The address is https://github.com/<my GitHub user name>/hive-mind
First check whether Git and Node are on this computer. If one is missing, tell me in one line what it is for, and install it only after my yes.
Then copy my private copy into a folder called hive-mind in my home folder.
Then ask me whether you may check with GitHub that my copy is private, and give me my Hive Mind code.
Done means: the folder hive-mind exists in my home folder and you have shown me my Hive Mind code.
```

Two free programs are needed. **Git** is the program that saves your notes to your private copy. **Node** runs the privacy check and the small programs that hold Claude to your rules.

**What happens next.** Claude asks you to allow each command before it runs it. These are the ones you will see, so you know what you are saying yes to:

| What Claude runs | What it does |
|---|---|
| `git --version` | Asks whether Git is here. A number like `git version 2.52.0` means yes. |
| `node --version` | Asks whether Node is here. A number like `v24.17.0` means yes. |
| `winget install --id Git.Git -e --source winget` | Windows only, if Git is missing: installs Git from its makers through Windows' own installer. |
| `winget install --id OpenJS.NodeJS.LTS -e --source winget` | Windows only, if Node is missing: installs the long-term version of Node the same way. |
| `git clone <your address> "<your home folder>/hive-mind"` | Copies your private copy into the folder `hive-mind`. |
| `node hive-mind/core/skills/hive-doctor/scripts/doctor.mjs --code` | Reads this computer and prints your Hive Mind code. It changes nothing. With `--online` added, it also asks GitHub whether your copy is private. |

Windows may ask "Do you want to allow this app to make changes to your device?" while it installs Git or Node. Click **Yes**.

The first time Git reaches your private copy, a window opens and asks you to sign in to GitHub. Choose **Sign in with your browser**, sign in, and allow access. Signing in is yours to do; Claude never sees your password.

**You should see:** Claude says the folder `hive-mind` is in your home folder, and shows you one short line that starts `HM-`: your Hive Mind code.

> **Your Hive Mind code:**
> - First Claude asks: "May I ask GitHub whether your copy is private?" Say yes if you can. It asks GitHub one question about your copy and sends nothing else. If you say no, nothing leaves this computer.
> - Then Claude shows one line, for example `HM-7K2Q-9D`. It holds no name, no folder and no notes, so it is safe to paste or to show someone.
> - If you follow the steps page, paste the code there. It should now show your copy and this computer as done, and the rest as not yet. If you said no to the question, your copy's privacy shows as not checked.

> **On a Mac or Linux** (not tried yet):
> - On a Mac, the first `git --version` may open a window offering Apple's "command line developer tools". Click **Install** and wait; that is Git.
> - Node: Claude will point you to the installer on [nodejs.org](https://nodejs.org/en/download). Download the long-term version ("LTS"), open it and click through.
> - On Linux, Claude tells you the one line that installs Git and Node on your system. You type it in the Terminal yourself, because it asks for your password.
> - Signing in: a Mac or Linux computer has no sign-in window for Git. Claude will suggest GitHub's own small program, `gh`, and ask you to type `gh auth login` once in the Terminal app and answer its questions (GitHub.com, HTTPS, yes, sign in with a web browser). Anthropic's [terminal guide](https://code.claude.com/docs/en/terminal-guide) shows how to open the Terminal.

> **If this happens:**
> - **Claude says Node or Git is still not found, right after installing it.** The Claude app only sees new programs after a restart. Quit the Claude app completely (use **Quit** or **Exit** in the app's menu; closing the window may leave it running), open it again, open a chat in your home folder as in step 2, and say "check again".
> - **`winget` is not recognised.** Your Windows is missing its own installer. Claude will give you the download pages instead: [git-scm.com/downloads/win](https://git-scm.com/downloads/win) for Git and [nodejs.org](https://nodejs.org/en/download) for Node. Install each with the default choices.
> - **"Repository not found".** The address has a typing mistake, or you signed in to GitHub with another account. Check the address on your copy's page, and that the account you signed in with owns it.
> - **The folder ended up somewhere else** (for example in Documents). That is fine. Hive Mind looks for it at `hive-mind` in your home folder unless it has written down another place, and it writes that place down when it adds its small parts in step 5. In step 4, open the folder where it really is.

---

## Step 4. Set up your Hive Mind (about 5 minutes)

1. Open a **new** chat in the Code tab, the same way as step 2, but this time choose the folder **hive-mind** inside your home folder.
2. Say:

   ```
   Set up my Hive Mind
   ```

3. Claude asks two short questions, one at a time: what to call you, and what fills your days. You can say "skip" to either.
4. Claude builds your notes, your places and your projects, and shows you **Here's your Hive Mind**.
5. Claude asks two picks for your **starting set**, a ready list of skills, tools, rules and habits, one at a time:
   - **The size:** Light (the essentials; every chat stays small, which matters most on the simplest Claude plan), Standard (the next most useful tools) or Full (everything reviewed). Skip, and you get Light.
   - **The kind:** everyday, student, builder, designer or small business. It decides what is inside the size. Skip, and you get everyday.

   Claude then tells you what you have and, for Light or Standard, what it leaves out. Nothing on the list is installed or connected until you say yes to that one thing. To change either pick, then or any day, say one sentence, for example "switch to Standard" or "make me a builder".

   Every size has one coding skill that comes built into Claude Code, because Claude loads a coding skill before it writes any code for you. Where a size has Figma, Canva, Whimsical or Vercel, Claude says that each is free to connect and has paid plans of its own, and nothing is bought without your yes.

Everything else, Claude learns as it goes. It asks each small question once, only when it first matters: which project comes first, whether you want a short brief each day, whether it should bring you ideas, whether a project is for an employer, and which folder a project lives in. Just before your notes are first saved online, it asks whether there are names that must never be saved. You can skip any of them.

**You should see:** a short message that starts "Here's your Hive Mind" with your name, your places (Today, Initiative, Life and System, plus any of your own) and your projects.

> **If this happens:**
> - **You kept your answers from an earlier setup** in a block that starts with `HIVE MIND SETUP ANSWERS`. Paste that block instead of answering again. Claude only checks the answers with you.
> - **Claude does not start the questions.** Check that the chat is in the `hive-mind` folder (step 4, point 1), then say "Set up my Hive Mind" again.

---

## Step 5. Let Claude add the small parts (about 5 minutes)

Claude offers to add a few small parts to Claude on this computer. They make every new chat read your notes first, and they include **checks** that hold Claude to your rules (Hive Mind calls them **gates**). Say yes.

Claude first tells you in plain words what would change, then does it. You do not need to read the list of files it prints. Before it changes any of Claude's own settings, it keeps a dated copy of each file, so everything can be undone (see [When something breaks](when-it-breaks.md#undo-everything)).

**You should see:** Claude says the parts are in place and the checks passed.

> **If this happens:** Claude says "node was not found". Go back to step 3, install Node, restart the Claude app, and say "add the small parts".

> **Your Hive Mind code:** say `Give me my Hive Mind code`. Claude may ask again whether it may ask GitHub about your copy; either answer is fine. Paste the new code into the steps page. It should now also show setting up and the small parts as done. Your first save still shows as not yet: that is step 6.

---

## Step 6. The first save (about 3 minutes)

Claude runs the privacy check (it refuses to save passwords, keys and the private names you gave), saves your notes on this computer, and asks: **"Shall I save your notes to your private GitHub copy now?"** Say yes. Then it asks whether it should save there by itself after every privacy check, or ask each time. Either answer is fine.

**You should see:** a line that starts `Saved:`.

> **If this happens:** see [When something breaks](when-it-breaks.md): "A save was refused" and "Saving online failed".

---

## Step 7. Check that it worked (about 5 minutes)

1. Open a **new** chat in the `hive-mind` folder and say only `hello`.
   **You should see:** at the top, a small box headed **HIVE MIND** (whether your notes are saved, which project you are in). Claude greets you by name, says where you stopped, and what comes next.
2. Tell Claude a small rule, for example `always call me by my first name`.
   **You should see:** a line that starts `Saved:`.
3. Say `run the privacy check`.
   **You should see:** Claude says your notes are clean.

> **If this happens:** no HIVE MIND box appears. See [When something breaks](when-it-breaks.md#no-hive-mind-box-at-the-start-of-a-chat).

> **Your Hive Mind code:** in the same chat, say `Give me my Hive Mind code` and paste it into the steps page. It should now show every step as done. If a step still shows as not yet, see [When something breaks](when-it-breaks.md#the-steps-page-says-a-step-is-not-done).

**That is the first hour.** From now on, open a chat in the `hive-mind` folder and just start talking. [Every day](daily-use.md) shows what you can say.

---

## Later, when you want them

- **A daily brief.** Say `set up my brief`. Claude explains it first: the brief is written by Claude in the cloud once or twice a day, from the notes in your private copy, so your notes are read in Anthropic's cloud at those times. Each run uses part of your plan's usage, like a chat does. How much it uses has not been measured yet. Nothing is scheduled without your yes.
- **Your page.** Not in this copy yet. It comes with a later release.
