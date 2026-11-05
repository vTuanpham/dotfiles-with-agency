import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { Plugin } from "@opencode/plugin";

const sessionID = (value) => typeof value === "string" && value.startsWith("ses")
  && value.length <= 200 && !/[\s\p{C}]/u.test(value);

async function attributeResources(ctx, event, command) {
  const child = event.sessionID;
  const seen = new Set();
  const signal = AbortSignal.timeout(3000);
  let current = child;
  for (let depth = 0; depth < 32; depth++) {
    if (!sessionID(current) || seen.has(current)) throw new Error("Invalid OpenCode resource ancestry.");
    seen.add(current);
    signal.throwIfAborted();
    const info = await ctx.session.get({ sessionID: current }, { signal });
    if (info?.id !== current) throw new Error("OpenCode resource ancestor was not verified.");
    if (info.parentID === undefined) {
      if (current === child) return; // Fork history is separate from native parentID ancestry.
      const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
      const owner = quote(`opencode:${current}`);
      // Each native shell call starts a fresh process; exports reach scripts without changing their cwd.
      event.input = { ...event.input, command:
        `export AGENT_RESOURCES_OWNER=\${AGENT_RESOURCES_OWNER-${owner}} `
        + `AGENT_RESOURCES_AGENT_ID=${quote(child)} AGENT_RESOURCES_WORKER=1\n${command}` };
      return;
    }
    current = info.parentID;
  }
  throw new Error("OpenCode resource ancestry exceeds 32 sessions.");
}

export default Plugin.define({
  id: "agent-process-guard",
  async setup(ctx) {
    await ctx.tool.hook("execute.before", async (event) => {
      if (event.tool !== "shell") return;
      const command = event.input?.command;
      if (typeof command !== "string") return;
      await attributeResources(ctx, event, command);
      if (!/\b(?:pgrep|pkill)\b/.test(command)) return;
      await new Promise((resolve, reject) => {
        const child = execFile(
          "python3", ["-I", join(homedir(), ".local/libexec/agent-process-guard.py")],
          { timeout: 5000, maxBuffer: 65536 },
          (error, stdout, stderr) => {
            if (!error) return resolve();
            reject(new Error(stderr.trim() || "Process-match guard is unavailable; use a native job handle or explicit owned PID."));
          },
        );
        child.stdin.on("error", () => {
          child.kill();
          reject(new Error("Process-match guard input failed; use a native job handle or explicit owned PID."));
        });
        child.stdin.end(JSON.stringify({ tool_input: { command } }));
      });
    });
  },
});
