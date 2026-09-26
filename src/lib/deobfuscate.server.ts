import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSource, type FetchStep } from "./loadstring.server";
import type { SourceKind } from "./loadstring";

export type PluginName = "auto" | "luraph_v15" | "ironbrew1" | "generic";
export type RunMode = "deobfuscate" | "detect";
export type JobStatus = "queued" | "resolving" | "running" | "done" | "error";

export type JobSnapshot = {
  id: string;
  status: JobStatus;
  log: string;
  result: string | null;
  error: string | null;
  elapsedMs: number;
  filename: string;
  kind: SourceKind;
  chain: FetchStep[];
  detected: { name: string; confidence: string; label: string } | null;
};

type Job = JobSnapshot & {
  createdAt: number;
  startedAt: number;
  proc?: ChildProcessWithoutNullStreams;
};

const CREDIT_LINE = "-- Deobfed by vdieo";
const CREDIT_RE = /^--\s*Deobf(?:uscated|ed)\s+by\s+.+$/gim;

export function stampCredit(text: string): string {
  const replaced = text.replace(CREDIT_RE, CREDIT_LINE);
  if (replaced.startsWith(CREDIT_LINE)) return replaced;
  const body = replaced.replace(/^\uFEFF/, "");
  return `${CREDIT_LINE}\n${body}`;
}

const jobs = new Map<string, Job>();
const JOB_TTL_MS = 30 * 60 * 1000;

function vendorRoot() {
  return join(process.cwd(), "vendor", "deobfuscator");
}

export function runtimeStatus() {
  const root = vendorRoot();
  const luau = join(root, "deobf", "bin", "luau");
  const ast = join(root, "deobf", "bin", "luau-ast");
  const deob = join(root, "deobf", "deob.py");
  return {
    python: "python3",
    hasDeob: existsSync(deob),
    hasLuau: existsSync(luau),
    hasAst: existsSync(ast),
    ready: existsSync(deob) && existsSync(luau) && existsSync(ast),
  };
}

function appendLog(job: Job, line: string) {
  const text = line.endsWith("\n") ? line : `${line}\n`;
  job.log += text;
}

function snapshot(job: Job): JobSnapshot {
  return {
    id: job.id,
    status: job.status,
    log: job.log,
    result: job.result,
    error: job.error,
    elapsedMs: Date.now() - job.startedAt,
    filename: job.filename,
    kind: job.kind,
    chain: job.chain,
    detected: job.detected,
  };
}

function gcJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) {
      try {
        job.proc?.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      jobs.delete(id);
    }
  }
}

export function getJob(id: string, cursor = 0): (JobSnapshot & { cursor: number }) | null {
  const job = jobs.get(id);
  if (!job) return null;
  const snap = snapshot(job);
  const safe = Math.max(0, Math.min(cursor, snap.log.length));
  return { ...snap, log: snap.log.slice(safe), cursor: snap.log.length };
}

export type StartJobInput = {
  source: string;
  url?: string;
  scriptKey?: string;
  filename?: string;
  plugin: PluginName;
  mode: RunMode;
  noDevirt: boolean;
  strings: boolean;
  timeout: number;
};

export function startJob(input: StartJobInput): JobSnapshot {
  gcJobs();
  const timeout = Math.max(15, Math.min(input.timeout || 90, 300));
  const filename = (input.filename || "script.lua").replace(/[^\w.\-]+/g, "_");
  const job: Job = {
    id: randomUUID(),
    status: "queued",
    log: "",
    result: null,
    error: null,
    elapsedMs: 0,
    filename,
    kind: "paste",
    chain: [],
    detected: null,
    createdAt: Date.now(),
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);
  void runJob(job, { ...input, timeout, filename });
  return snapshot(job);
}

async function runJob(job: Job, input: StartJobInput & { timeout: number; filename: string }) {
  const rt = runtimeStatus();
  if (!rt.ready) {
    job.status = "error";
    job.error = "The Luau runtime is not installed next to the deobfuscator, so jobs cannot run yet.";
    appendLog(job, "[!] luau / luau-ast / deob.py missing");
    return;
  }

  const work = mkdtempSync(join(tmpdir(), "deobf_web_"));
  try {
    job.status = "resolving";
    appendLog(job, "[*] resolving GitHub / Luarmor loadstrings…");
    const resolved = await resolveSource({
      source: input.source,
      url: input.url,
      scriptKey: input.scriptKey,
    });
    job.kind = resolved.kind;
    job.chain = resolved.chain;
    for (const step of resolved.chain) {
      appendLog(job, `[+] ${step.note}`);
    }
    if (resolved.chain.length === 0) {
      appendLog(job, "[*] input is already a script — skipping remote fetch");
    }

    const inName = input.filename.toLowerCase().endsWith(".lua")
      ? input.filename
      : `${input.filename}.lua`;
    const inPath = join(work, inName);
    mkdirSync(work, { recursive: true });
    writeFileSync(inPath, resolved.source, "latin1");

    const outPath = join(work, "result.lua");
    const budget = Math.max(8, Math.min(20, Math.floor(input.timeout / 3) || 20));
    const args = [
      "-u",
      join(vendorRoot(), "deobf", "deob.py"),
      inPath,
      "--timeout",
      String(input.timeout),
      "--budget",
      String(budget),
    ];
    if (input.mode === "detect") {
      args.push("--detect");
    } else {
      if (input.plugin !== "auto") args.push("--obfuscator", input.plugin);
      if (input.noDevirt) args.push("--no-devirt");
      if (input.strings) args.push("--strings");
      args.push("-o", outPath);
    }

    job.status = "running";
    appendLog(
      job,
      input.mode === "detect"
        ? "[*] running detector"
        : `[*] running Luraph v15 pipeline${input.plugin === "auto" ? " (auto-detect)" : ` (${input.plugin})`}`,
    );

    const { code, stdout } = await spawnDeob(job, args, input.timeout);

    if (input.mode === "detect") {
      const line = stdout.trim().split("\n").filter(Boolean).at(-1) ?? "";
      const parts = line.split("\t");
      if (parts.length >= 3) {
        job.detected = { name: parts[0], confidence: parts[1], label: parts[2] };
        job.result = `${parts[2]}\nplugin: ${parts[0]}\nconfidence: ${parts[1]}`;
        job.status = "done";
        appendLog(job, `[+] detected ${parts[2]} (${parts[1]})`);
      } else {
        job.status = "error";
        job.error = "Detection produced no result.";
      }
      return;
    }

    if (code === 0 && existsSync(outPath)) {
      job.result = stampCredit(readFileSync(outPath, "latin1"));
      job.status = "done";
      appendLog(job, `[+] done — ${job.result.length} bytes`);
    } else {
      job.status = "error";
      job.error = "The pipeline finished without a result. Check the log.";
    }
  } catch (err) {
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err);
    appendLog(job, `[!] ${job.error}`);
  } finally {
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function spawnDeob(
  job: Job,
  args: string[],
  timeoutSec: number,
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", args, {
      cwd: vendorRoot(),
      env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "latin-1" },
    });
    job.proc = proc;
    let stdout = "";

    const pump = (chunk: string, intoStdout: boolean) => {
      if (intoStdout) stdout += chunk;
      for (const line of chunk.split(/\r?\n/)) {
        if (line) appendLog(job, line);
      }
    };

    proc.stdout.setEncoding("latin1");
    proc.stderr.setEncoding("latin1");
    proc.stdout.on("data", (chunk: string) => pump(chunk, true));
    proc.stderr.on("data", (chunk: string) => pump(chunk, false));

    const killer = setTimeout(() => {
      proc.kill("SIGKILL");
    }, (timeoutSec + 20) * 1000);

    proc.on("error", (err) => {
      clearTimeout(killer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(killer);
      resolve({ code: code ?? 1, stdout });
    });
  });
}

export function loadSampleSource(): string {
  return readFileSync(
    join(vendorRoot(), "samples", "001_vm_like_dispatch-obfuscated.lua"),
    "latin1",
  );
}
