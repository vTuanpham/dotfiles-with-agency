import { afterAll, expect, mock, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

mock.module("@opencode/plugin", () => ({ Plugin: { define: (plugin) => plugin } }));
const home = mkdtempSync(join(tmpdir(), "process-guard-plugin-"));
let helperHome = home;
mock.module("node:os", () => ({ homedir: () => helperHome }));
const { default: plugin } = await import("../opencode/.config/opencode/plugins/agent-process-guard.js");
mkdirSync(join(home, ".local/libexec"), { recursive: true });
symlinkSync(fileURLToPath(new URL("../shell/.local/libexec/agent-process-guard.py", import.meta.url)),
  join(home, ".local/libexec/agent-process-guard.py"));
afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

test("OpenCode's native before hook blocks dangerous matching without executing it", async () => {
  let before;
  await plugin.setup({ tool: { hook: async (name, callback) => {
    expect(name).toBe("execute.before");
    before = (event) => callback({ sessionID: "ses_root", ...event });
  } }, session: { get: async () => ({ id: "ses_root" }) } });
  await before({ tool: "read", input: { command: "pkill -f worker" } });
  await before({ tool: "shell", input: { command: "git status" } });
  await before({ tool: "shell", input: { command: "pgrep -Af worker" } });
  await before({ tool: "shell", input: { command: "printf '%s' 'pkill -f worker'" } });
  await expect(before({ tool: "shell", input: { command: "pkill -f worker" } }))
    .rejects.toThrow("owned PID");
  helperHome = join(home, "missing");
  try {
    await expect(before({ tool: "shell", input: { command: "pgrep -f worker" } }))
      .rejects.toBeInstanceOf(Error);
  } finally { helperHome = home; }
});

async function resourceHook(rows) {
  let before;
  const reads = [];
  await plugin.setup({
    tool: { hook: async (_name, callback) => { before = callback; } },
    session: { get: async ({ sessionID }, options) => {
      expect(options.signal).toBeInstanceOf(AbortSignal);
      reads.push(sessionID);
      if (!Object.hasOwn(rows, sessionID)) throw new Error("Missing ancestor");
      return rows[sessionID];
    } },
  });
  return { before, reads };
}

test("native OpenCode shells use verified parentID ancestry, stopping at fork roots", async () => {
  const { before, reads } = await resourceHook({
    ses_child: { id: "ses_child", parentID: "ses_middle" },
    ses_middle: { id: "ses_middle", parentID: "ses_fork" },
    ses_fork: { id: "ses_fork", fork: { sessionID: "ses_original" } },
  });
  for (const action of ["run --mem 1G -- python3 task.py", "list --json --owner opencode:ses_fork",
    "cancel sibling", "pause --reason review", "resume"]) {
    const event = { tool: "shell", sessionID: "ses_child", input: { command: `agent-resources ${action}` } };
    await before(event);
    expect(event.input.command).toContain("AGENT_RESOURCES_OWNER=${AGENT_RESOURCES_OWNER-'opencode:ses_fork'}");
    expect(event.input.command).toContain("AGENT_RESOURCES_AGENT_ID='ses_child' AGENT_RESOURCES_WORKER=1");
    expect(event.input.command.endsWith(`agent-resources ${action}`)).toBe(true);
  }
  expect(reads).toEqual(Array.from({ length: 5 }, () => ["ses_child", "ses_middle", "ses_fork"]).flat());
});

test("shell exports preserve enclosing Bridge ownership and never change the plugin environment", async () => {
  const { before } = await resourceHook({
    ses_child: { id: "ses_child", parentID: "ses_root'$(false)" },
    "ses_root'$(false)": { id: "ses_root'$(false)" },
  });
  const event = { tool: "shell", sessionID: "ses_child", input: { command: "agent-resources run -- unused" } };
  const metadata = () => [process.env.AGENT_RESOURCES_OWNER, process.env.AGENT_RESOURCES_AGENT_ID,
    process.env.AGENT_RESOURCES_WORKER];
  const parentEnvironment = metadata();
  await before(event);
  const script = "agent-resources() { printf '%s|%s|%s' \"$AGENT_RESOURCES_OWNER\" \"$AGENT_RESOURCES_AGENT_ID\" \"$AGENT_RESOURCES_WORKER\"; }\n"
    + event.input.command;
  for (const [env, expected] of [[{}, "opencode:ses_root'$(false)"],
    [{ AGENT_RESOURCES_OWNER: "claude:bridge-root" }, "claude:bridge-root"]]) {
    const ran = spawnSync("/bin/bash", ["-c", script], { env, encoding: "utf8" });
    expect(ran.status).toBe(0);
    expect(ran.stderr).toBe("");
    expect(ran.stdout).toBe(`${expected}|ses_child|1`);
    const next = spawnSync("/bin/bash", ["-c",
      "printf '%s|%s|%s' \"$AGENT_RESOURCES_OWNER\" \"$AGENT_RESOURCES_AGENT_ID\" \"$AGENT_RESOURCES_WORKER\""],
    { env, encoding: "utf8" });
    expect(next.status).toBe(0);
    expect(next.stdout).toBe(`${env.AGENT_RESOURCES_OWNER ?? ""}||`);
  }
  expect(metadata()).toEqual(parentEnvironment);
});

test("native-child exports reach compound env calls and scripts without changing cwd or exit status", async () => {
  const workspace = join(home, "resource-work");
  mkdirSync(join(workspace, "work"), { recursive: true });
  mkdirSync(join(workspace, "bin"), { recursive: true });
  writeFileSync(join(workspace, "bin/agent-resources"), "#!/bin/bash\n"
    + "printf '%s|%s|%s|%s|%s|%s|%s' \"$AGENT_RESOURCES_OWNER\" \"$AGENT_RESOURCES_AGENT_ID\" \"$AGENT_RESOURCES_WORKER\" \"$X\" \"$Y\" \"${PWD##*/}\" \"$*\"\n",
  { mode: 0o700 });
  const resourceCall = "env X=one Y=two agent-resources run --mem 1G -- task";
  writeFileSync(join(workspace, "task.sh"), resourceCall + "\n");
  const { before } = await resourceHook({ ses_child: { id: "ses_child", parentID: "ses_root" },
    ses_root: { id: "ses_root" } });
  for (const [command, status] of [[`cd work\n${resourceCall}`, 0], ["cd work\n/bin/bash ../task.sh", 0],
    [`cd work && ${resourceCall}\nexit 7`, 7]]) {
    const event = { tool: "shell", sessionID: "ses_child", input: { command, workdir: workspace, timeout: 123 } };
    await before(event);
    expect(event.input.workdir).toBe(workspace);
    expect(event.input.timeout).toBe(123);
    expect(event.input.command.endsWith("\n" + command)).toBe(true);
    const ran = spawnSync("/bin/bash", ["-c", event.input.command], {
      cwd: event.input.workdir, env: { PATH: `${workspace}/bin:/usr/bin:/bin` }, encoding: "utf8",
    });
    expect(ran.status).toBe(status);
    expect(ran.stderr).toBe("");
    expect(ran.stdout).toBe("opencode:ses_root|ses_child|1|one|two|work|run --mem 1G -- task");
  }
});

test("concurrent identical script commands keep their exact native-child attribution", async () => {
  const { before } = await resourceHook({
    ses_a: { id: "ses_a", parentID: "ses_root_a" }, ses_root_a: { id: "ses_root_a" },
    ses_b: { id: "ses_b", parentID: "ses_root_b" }, ses_root_b: { id: "ses_root_b" },
  });
  const events = ["a", "b"].map(suffix => ({ tool: "shell", sessionID: `ses_${suffix}`,
    input: { command: "/bin/bash task.sh" } }));
  await Promise.all(events.map(before));
  for (const [index, suffix] of ["a", "b"].entries()) {
    expect(events[index].input.command).toContain(`'opencode:ses_root_${suffix}'`);
    expect(events[index].input.command).toContain(`AGENT_RESOURCES_AGENT_ID='ses_${suffix}'`);
  }
});

test("root sessions and history forks retain root authority", async () => {
  for (const info of [{ id: "ses_root" }, { id: "ses_root", fork: { sessionID: "ses_original" } }]) {
    const { before } = await resourceHook({ ses_root: info });
    const event = { tool: "shell", sessionID: "ses_root", input: { command: "agent-resources resume" } };
    await before(event);
    expect(event.input.command).toBe("agent-resources resume");
  }
});

test("root shell commands stay unchanged and unrelated tools do not read ancestry", async () => {
  const { before, reads } = await resourceHook({ ses_root: { id: "ses_root" } });
  for (const command of ["git status", "rtk summary agent-resources list", "env X=1 agent-resources run -- task"]) {
    const event = { tool: "shell", sessionID: "ses_root", input: { command } };
    await before(event);
    expect(event.input.command).toBe(command);
  }
  await before({ tool: "read", sessionID: "ses_child", input: { command: "agent-resources run -- task" } });
  expect(reads).toEqual(["ses_root", "ses_root", "ses_root"]);
});

test("absolute allocator paths retain their command, arguments and leading whitespace", async () => {
  const { before } = await resourceHook({ ses_child: { id: "ses_child", parentID: "ses_root" },
    ses_root: { id: "ses_root" } });
  const command = "  /home/u/.local/bin/agent-resources run --mem 3G -- python3 task.py '$literal'";
  const event = { tool: "shell", sessionID: "ses_child", input: { command, timeout: 12 } };
  await before(event);
  expect(event.input.timeout).toBe(12);
  expect(event.input.command.startsWith("export AGENT_RESOURCES_OWNER=")).toBe(true);
  expect(event.input.command.endsWith("\n" + command)).toBe(true);
});

test("invalid, cyclic, missing or excessive resource ancestry is rejected without rewriting", async () => {
  const cases = [
    { ses_child: { id: "ses_child", parentID: "ses_child" } },
    { ses_child: { id: "ses_child", parentID: "ses_missing" } },
    { ses_child: { id: "ses_other" } },
    ...[null, "", "bad", "ses_bad\nroot", "ses_a\u200bb", "ses_" + "a".repeat(201)].map(parentID => ({
      ses_child: { id: "ses_child", parentID },
    })),
    Object.fromEntries(Array.from({ length: 33 }, (_, i) => [i ? `ses_${i}` : "ses_child", {
      id: i ? `ses_${i}` : "ses_child", parentID: `ses_${i + 1}`,
    }])),
  ];
  for (const rows of cases) {
    const { before, reads } = await resourceHook(rows);
    const event = { tool: "shell", sessionID: "ses_child", input: { command: "agent-resources run -- task" } };
    await expect(before(event)).rejects.toBeInstanceOf(Error);
    expect(reads.length).toBeLessThanOrEqual(32);
    expect(event.input.command).toBe("agent-resources run -- task");
  }
});

test("resource ancestry reads share a bounded cancellation signal", async () => {
  let before;
  await plugin.setup({
    tool: { hook: async (_name, callback) => { before = callback; } },
    session: { get: async (_input, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }) },
  });
  const event = { tool: "shell", sessionID: "ses_child", input: { command: "agent-resources run -- task" } };
  await expect(before(event)).rejects.toBeInstanceOf(Error);
  expect(event.input.command).toBe("agent-resources run -- task");
});
