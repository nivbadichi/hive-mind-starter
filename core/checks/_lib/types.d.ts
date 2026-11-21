// The contract's types. Use them in a check with:  /** @type {import('../_lib/types').Check} */
// The source of the contract is system/design/enforcement-2026-11-20.md; where this differs, core/checks/README.md says so.

export type StepName = 'pretool' | 'posttool' | 'prompt' | 'stop' | 'helperstop';
export type Kind = 'safety' | 'discipline';
export type Mode = 'refuse' | 'notice' | 'off';

/** The hook's own input as Claude Code gives it, plus the fields the loader adds. */
export interface Ev {
  session_id?: string; transcript_path?: string; cwd?: string; hook_event_name?: string; permission_mode?: string;
  agent_id?: string; agent_type?: string;
  tool_name?: string; tool_input?: Record<string, any>; tool_response?: any; tool_use_id?: string;
  error?: string; prompt?: string; last_assistant_message?: string; stop_hook_active?: boolean;
  [field: string]: any;
  /** Added by the loader. */
  step: StepName;
  tool: string;
  input: Record<string, any>;
  /** The shell text when the tool is Bash or PowerShell, else ''. */
  command: string;
  /** The person's message at prompt; Claude's reply at stop; at helperstop the helper's delivered report (its handback
   *  message) when the after-tool hook saw it, else its last words; else ''. */
  text: string;
  /** helperstop only: true when text is the delivered report, false when it is the helper's last words. */
  report?: boolean;
}

/** One thing that ran in this turn (reset at each of the person's messages). */
export type TurnEvent =
  | { kind: 'tool'; tool: string; ok: boolean; exit?: number; command?: string; path?: string; agent?: string; report?: string; t: number }
  | { kind: 'write'; path: string; agent?: string }      // a file written (from the gates' record; shell writes included)
  | { kind: 'check'; ok: boolean; command: string };     // a test, build or check command (from the gates' record)

export interface Ctx {
  /** The notebook folder. */ root: string;
  /** The Hive folder for records (~/.claude/hive). */ state: string;
  sid: string; step: StepName;
  /** Set when a helper (subagent) made this tool call. */ agentId: string;
  /** Who the notebook belongs to, from _lib/settings.json "who" ("the person" when unset): use it in words a person reads. */ who: string;
  /** The person's latest own message, in its own case. '' in a helper chat (a starter chat's words are never the person's). */ hisLast: string;
  /** True when the person's latest own message names that act: a word or phrase (whole words, any case), a RegExp, or a list of either. */
  said(pattern: string | RegExp | Array<string | RegExp>): boolean;
  /** The prompt of this step is the person's own message (false for a helper's report, a task notice or another chat's message). */ hisNow: boolean;
  /** The person's answers on question cards since their last own message. */ cards: ReadonlyArray<{ question: string; answer: string }>;
  /** The person's word for an act: their latest own message names one of the words, or they said yes on a card that asked about it. */
  approved(words: string | string[]): boolean;
  isHelperChat: boolean;
  /** Skills really loaded in this chat (by it or its helpers), lower case, as the Skill tool named them. */ loaded: string[];
  /** True when that skill was loaded; "testing-strategy" matches "engineering:testing-strategy". */ hasLoaded(name: string): boolean;
  events: TurnEvent[];
  /** A note's text by its path inside the notebook, cached; '' when missing or outside the notebook. */ read(rel: string): string;
  /** This check's own settings.json. */ settings: Record<string, any>;
  /** This check's own debts that are open now. */ debts: Array<{ key: string; text: string; status: 'open' | 'overdue' }>;
  log(event: string, detail?: Record<string, any>): void;
}

export interface Debt {
  key: string;
  text: string;
  /** Default true: cleared by the next reply in which this check's stop step runs and does not raise the key again.
   *  false: stays until a step returns { clear: [key] }, and is overdue if the next reply ends with it still there. */
  auto?: boolean;
  /** While overdue, these may still run (the way out): tool names, and Write/Edit to paths inside the notebook. */
  allow?: { tools?: string[]; paths?: string[] };
}

/** null, or any of these together. deny: pretool only. debt: stop only. */
export type Result = null | {
  deny?: string;
  say?: string;
  debt?: Debt | Debt[];
  clear?: string[];
};

export type Step = (ev: Ev, ctx: Ctx) => Result | Promise<Result>;

export interface Check {
  id: string;
  rule: string;
  kind: Kind;
  mode?: Mode;
  about: string;
  steps: Partial<Record<StepName, Step>>;
}
