import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  Copy,
  Download,
  FileCode2,
  Github,
  Loader2,
  Play,
  Shield,
  Terminal,
  Link2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchLoadstringFn,
  getRuntimeStatusFn,
  loadSampleFn,
  pollJobFn,
  startDeobfuscateFn,
} from "@/lib/deobfuscate.functions";
import { cn } from "@/lib/utils";

type Plugin = "auto" | "luraph_v15" | "ironbrew1" | "generic";
type Mode = "deobfuscate" | "detect";
type InputTab = "script" | "loadstring" | "file";
type Job = Awaited<ReturnType<typeof pollJobFn>>;

const PLUGINS: { id: Plugin; label: string }[] = [
  { id: "luraph_v15", label: "Luraph v15" },
  { id: "auto", label: "Auto" },
  { id: "ironbrew1", label: "IronBrew1" },
  { id: "generic", label: "Trace" },
];

function downloadName(filename: string) {
  return filename.replace(/\.(luau?|txt)$/i, "") + ".deobf.lua";
}

function formatElapsed(ms: number) {
  const s = Math.max(0, ms) / 1000;
  return `${s.toFixed(1)}s`;
}

export function DeobfStudio() {
  const [inputTab, setInputTab] = useState<InputTab>("script");
  const [source, setSource] = useState("");
  const [url, setUrl] = useState("");
  const [scriptKey, setScriptKey] = useState("");
  const [filename, setFilename] = useState("script.lua");
  const [plugin, setPlugin] = useState<Plugin>("luraph_v15");
  const [mode, setMode] = useState<Mode>("deobfuscate");
  const [noDevirt, setNoDevirt] = useState(false);
  const [dumpStrings, setDumpStrings] = useState(false);
  const [timeout, setTimeoutSec] = useState(60);
  const [job, setJob] = useState<Job | null>(null);
  const [view, setView] = useState<"log" | "result">("log");
  const [drag, setDrag] = useState(false);
  const [runtimeReady, setRuntimeReady] = useState<boolean | null>(null);
  const [fetching, setFetching] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    void getRuntimeStatusFn()
      .then((s) => setRuntimeReady(s.ready))
      .catch(() => setRuntimeReady(false));
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job?.log]);

  const running = job?.status === "queued" || job?.status === "resolving" || job?.status === "running";

  const stopPoll = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => stopPoll(), []);

  const watch = (id: string) => {
    stopPoll();
    const tick = () => {
      void pollJobFn({ data: { id } })
        .then((next) => {
          setJob(next);
          if (next.status === "done") {
            setView("result");
            stopPoll();
          } else if (next.status === "error") {
            setView("log");
            stopPoll();
          }
        })
        .catch((err: unknown) => {
          stopPoll();
          toast.error(err instanceof Error ? err.message : "Polling failed");
        });
    };
    tick();
    pollRef.current = window.setInterval(tick, 280);
  };

  const readFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    setSource(new TextDecoder("latin1").decode(buf));
    setFilename(file.name || "script.lua");
    setInputTab("file");
    toast.success(`Loaded ${file.name} (${file.size.toLocaleString()} bytes)`);
  };

  const onFileChosen = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void readFile(file);
    e.target.value = "";
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files[0];
    if (file) await readFile(file);
  };

  const openLoadstring = () => {
    setInputTab("loadstring");
    window.requestAnimationFrame(() => urlRef.current?.focus());
  };

  const fetchRemote = useCallback(async () => {
    const payloadUrl = url.trim();
    const payloadSource = source.trim();
    if (!payloadUrl && !payloadSource) {
      toast.error("Paste a GitHub / Luarmor URL or a loadstring first.");
      return;
    }
    setFetching(true);
    try {
      const resolved = await fetchLoadstringFn({
        data: {
          source: payloadSource,
          url: payloadUrl || undefined,
          scriptKey: scriptKey.trim() || undefined,
        },
      });
      setSource(resolved.source);
      if (resolved.chain[0]?.url) {
        setUrl(resolved.chain[0].url);
      }
      toast.success(`Fetched ${resolved.source.length.toLocaleString()} bytes`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not fetch loadstring");
    } finally {
      setFetching(false);
    }
  }, [scriptKey, source, url]);

  const run = useCallback(async () => {
    const payloadUrl = inputTab === "loadstring" ? url.trim() : undefined;
    if (!source.trim() && !payloadUrl) {
      toast.error("Paste a script, choose a file, or enter a loadstring URL.");
      return;
    }
    if (runtimeReady === false) {
      toast.error("The Luau runtime is missing, so decompile jobs cannot start.");
      return;
    }
    setView("log");
    try {
      const started = await startDeobfuscateFn({
        data: {
          source,
          url: payloadUrl || undefined,
          scriptKey: scriptKey.trim() || undefined,
          filename,
          plugin,
          mode,
          noDevirt,
          strings: dumpStrings,
          timeout,
        },
      });
      setJob(started);
      watch(started.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the job");
    }
  }, [
    dumpStrings,
    filename,
    inputTab,
    mode,
    noDevirt,
    plugin,
    runtimeReady,
    scriptKey,
    source,
    timeout,
    url,
  ]);

  const loadSample = async () => {
    try {
      const sample = await loadSampleFn();
      setSource(sample.source);
      setFilename(sample.filename);
      setInputTab("script");
      setPlugin("luraph_v15");
      setMode("deobfuscate");
      toast.success("Loaded the Luraph v15 sample");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load sample");
    }
  };

  const copyResult = async () => {
    if (!job?.result) return;
    await navigator.clipboard.writeText(job.result);
    toast.success("Copied decompiled code");
  };

  const downloadResult = () => {
    if (!job?.result) return;
    const blob = new Blob([job.result], { type: "text/plain;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = downloadName(job.filename || filename);
    a.click();
    URL.revokeObjectURL(href);
  };

  const tabClass = (id: InputTab) =>
    cn(
      "relative inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 overflow-hidden rounded-md px-3 text-sm font-medium sm:flex-none",
      inputTab === id ? "bg-surface text-fg" : "text-muted hover:text-fg",
    );

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-xs tracking-[0.22em] text-muted uppercase">Deobf</p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight text-fg sm:text-3xl">
              Luraph v15 decompiler
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
              Paste protected Luau, pick a file, or fetch a GitHub / Luarmor loadstring. Output is
              stamped deobfed by vdieo.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Luraph v15</Badge>
            <Badge>GitHub loadstring</Badge>
            <Badge>Luarmor fetch</Badge>
          </div>
        </div>
      </header>

      {runtimeReady === false ? (
        <div className="border-b border-border bg-fail/10 px-4 py-3 text-sm text-fail sm:px-6 lg:px-8">
          The Luau runtime is missing, so decompile jobs cannot start.
        </div>
      ) : null}

      <main className="mx-auto grid w-full max-w-[1400px] flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-2 lg:gap-6 lg:p-6">
        <section className="flex min-h-0 flex-col rounded-xl bg-surface p-4 shadow-[0_0_0_1px_rgb(255_255_255_/_0.08)] sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium tracking-wide text-fg">Input</h2>
            <Button variant="ghost" size="sm" onClick={() => void loadSample()} type="button">
              Load v15 sample
            </Button>
          </div>

          <div
            role="tablist"
            aria-label="Input source"
            className="inline-flex h-11 w-full items-center justify-start gap-1 rounded-lg bg-surface-2 p-1 text-muted shadow-[0_0_0_1px_rgb(255_255_255_/_0.06)] sm:w-auto"
          >
            <button
              type="button"
              role="tab"
              aria-selected={inputTab === "script"}
              className={tabClass("script")}
              onClick={() => setInputTab("script")}
            >
              <FileCode2 className="pointer-events-none size-3.5" />
              Script
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inputTab === "loadstring"}
              className={tabClass("loadstring")}
              onClick={openLoadstring}
            >
              <Link2 className="pointer-events-none size-3.5" />
              Loadstring
            </button>
            <div
              role="tab"
              aria-selected={inputTab === "file"}
              className={tabClass("file")}
            >
              <Terminal className="pointer-events-none size-3.5" />
              File
              <input
                type="file"
                accept=".lua,.luau,.txt,text/plain,.lua.txt"
                className="absolute inset-0 z-10 cursor-pointer opacity-0"
                title="Choose a Lua file"
                onClick={() => setInputTab("file")}
                onChange={onFileChosen}
              />
            </div>
          </div>

          {inputTab === "script" ? (
            <div className="mt-3">
              <Textarea
                value={source}
                onChange={(e) => setSource(e.target.value)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => void onDrop(e)}
                spellCheck={false}
                placeholder={`-- This file was protected using Luraph Obfuscator v15
-- or paste a loadstring(game:HttpGet("…"))() stub`}
                className={cn("min-h-64 font-mono text-sm", drag && "shadow-[0_0_0_1px_rgb(215_221_216_/_0.55)]")}
              />
            </div>
          ) : null}

          {inputTab === "loadstring" ? (
            <div className="mt-3 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ls-url">GitHub or Luarmor URL</Label>
                <div className="relative">
                  <Github className="pointer-events-none absolute top-3.5 left-3 size-4 text-subtle" />
                  <Input
                    ref={urlRef}
                    id="ls-url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void fetchRemote();
                      }
                    }}
                    placeholder="https://api.luarmor.net/files/v3/loaders/….lua"
                    className="pl-10 font-mono text-sm"
                  />
                </div>
                <p className="text-xs leading-relaxed text-subtle">
                  Accepts raw GitHub / gist URLs, github.com blob links, Luarmor v3/v4 loaders, or a
                  full <span className="font-mono text-muted">loadstring(game:HttpGet(…))()</span>{" "}
                  stub. Press Fetch to pull the remote script.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ls-key">Luarmor script_key (optional)</Label>
                <Input
                  id="ls-key"
                  value={scriptKey}
                  onChange={(e) => setScriptKey(e.target.value)}
                  placeholder="script_key if the loader requires one"
                  className="font-mono text-sm"
                />
              </div>
              <Textarea
                value={source}
                onChange={(e) => setSource(e.target.value)}
                spellCheck={false}
                placeholder={'script_key = "KEY"\nloadstring(game:HttpGet("https://api.luarmor.net/files/v3/loaders/….lua"))()'}
                className="min-h-40 font-mono text-sm"
              />
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => void fetchRemote()}
                disabled={fetching}
              >
                {fetching ? <Loader2 className="animate-spin" /> : <Link2 />}
                {fetching ? "Fetching…" : "Fetch loadstring"}
              </Button>
            </div>
          ) : null}

          {inputTab === "file" ? (
            <div className="mt-3">
              <div
                className={cn(
                  "relative flex min-h-48 w-full flex-col items-center justify-center overflow-hidden rounded-lg bg-surface-2 px-4 text-center shadow-[0_0_0_1px_rgb(255_255_255_/_0.08)] transition-[box-shadow] duration-150",
                  drag && "shadow-[0_0_0_1px_rgb(215_221_216_/_0.55)]",
                )}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => void onDrop(e)}
              >
                <FileCode2 className="mb-3 size-6 text-muted" />
                <p className="text-sm text-fg">Drop a .lua / .luau file</p>
                <p className="mt-1 text-xs text-subtle">or click to choose · {filename}</p>
                {source ? (
                  <p className="mt-3 font-mono text-xs text-ok">
                    {source.length.toLocaleString()} bytes loaded
                  </p>
                ) : null}
                <span className="mt-4 inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg">
                  Choose file
                </span>
                <input
                  type="file"
                  accept=".lua,.luau,.txt,text/plain,.lua.txt"
                  className="absolute inset-0 z-10 cursor-pointer opacity-0"
                  title="Choose a Lua file"
                  onChange={onFileChosen}
                />
              </div>
            </div>
          ) : null}

          <div className="mt-5 space-y-4">
            <div className="space-y-2">
              <Label>Plugin</Label>
              <div className="flex flex-wrap gap-1.5">
                {PLUGINS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlugin(p.id)}
                    className={cn(
                      "h-10 rounded-md px-3 text-sm font-medium transition-colors duration-150",
                      plugin === p.id
                        ? "bg-primary text-primary-fg"
                        : "bg-surface-2 text-muted shadow-[0_0_0_1px_rgb(255_255_255_/_0.08)] hover:text-fg",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <label className="flex min-h-11 items-center gap-2.5 text-sm text-fg">
                <Switch
                  checked={mode === "detect"}
                  onCheckedChange={(on) => setMode(on ? "detect" : "deobfuscate")}
                />
                Detect only
              </label>
              <label className="flex min-h-11 items-center gap-2.5 text-sm text-fg">
                <Switch checked={noDevirt} onCheckedChange={setNoDevirt} disabled={mode === "detect"} />
                Fast trace
              </label>
              <label className="flex min-h-11 items-center gap-2.5 text-sm text-fg">
                <Switch
                  checked={dumpStrings}
                  onCheckedChange={setDumpStrings}
                  disabled={mode === "detect"}
                />
                Dump strings
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm text-fg">
                Timeout
                <Input
                  type="number"
                  min={15}
                  max={300}
                  value={timeout}
                  onChange={(e) => setTimeoutSec(Number(e.target.value) || 60)}
                  className="h-10 w-20"
                />
                <span className="text-subtle">s</span>
              </label>
            </div>

            <Button type="button" size="lg" className="w-full" onClick={() => void run()} disabled={running}>
              {running ? <Loader2 className="animate-spin" /> : <Play className="ml-0.5" />}
              {running ? "Decompiling…" : mode === "detect" ? "Detect obfuscator" : "Decompile"}
            </Button>
          </div>
        </section>

        <section className="flex min-h-0 flex-col rounded-xl bg-surface p-4 shadow-[0_0_0_1px_rgb(255_255_255_/_0.08)] sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium tracking-wide text-fg">Output</h2>
              <StatusBadge job={job} />
              {job ? (
                <span className="font-mono text-xs text-subtle tabular-nums">
                  {formatElapsed(job.elapsedMs)}
                </span>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void copyResult()}
                disabled={!job?.result}
              >
                <Copy />
                Copy
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={downloadResult}
                disabled={!job?.result || job.status !== "done"}
              >
                <Download />
                Download
              </Button>
            </div>
          </div>

          {job?.chain?.length ? (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {job.chain.map((step) => (
                <Badge key={step.url} className="max-w-full truncate font-mono normal-case">
                  {step.kind}: {step.url.replace(/^https?:\/\//, "")}
                </Badge>
              ))}
            </div>
          ) : null}

          <div className="mb-3 flex gap-1 rounded-lg bg-surface-2 p-1 shadow-[0_0_0_1px_rgb(255_255_255_/_0.06)]">
            <button
              type="button"
              onClick={() => setView("log")}
              className={cn(
                "h-9 flex-1 rounded-md text-sm font-medium",
                view === "log" ? "bg-surface text-fg" : "text-muted hover:text-fg",
              )}
            >
              Log
            </button>
            <button
              type="button"
              onClick={() => setView("result")}
              className={cn(
                "h-9 flex-1 rounded-md text-sm font-medium",
                view === "result" ? "bg-surface text-fg" : "text-muted hover:text-fg",
              )}
            >
              Decompiled
            </button>
          </div>

          {view === "log" ? (
            <pre
              ref={logRef}
              className="min-h-72 flex-1 overflow-auto rounded-lg bg-bg p-3 font-mono text-xs leading-5 text-muted shadow-[0_0_0_1px_rgb(255_255_255_/_0.06)] sm:min-h-96"
            >
              {job?.log ? (
                job.log
              ) : (
                <span className="text-subtle">
                  Pipeline output lands here. Fetch a Luarmor or GitHub loadstring, then the Luraph
                  v15 VM is traced and lifted.
                </span>
              )}
            </pre>
          ) : (
            <pre className="min-h-72 flex-1 overflow-auto rounded-lg bg-bg p-3 font-mono text-xs leading-5 text-fg shadow-[0_0_0_1px_rgb(255_255_255_/_0.06)] sm:min-h-96">
              {job?.result ? (
                job.result
              ) : (
                <span className="text-subtle">
                  {job?.error ?? "No decompiled output yet. Run a job, then download from here."}
                </span>
              )}
            </pre>
          )}

          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-subtle">
            <Shield className="mt-0.5 size-3.5 shrink-0" />
            Scripts run inside a fake Roblox environment used only to lift Luraph bytecode. Remote
            loaders are fetched server-side so you get the protected payload, not the stub.
          </p>
        </section>
      </main>
    </div>
  );
}

function StatusBadge({ job }: { job: Job | null }) {
  if (!job) return <Badge>idle</Badge>;
  if (job.status === "done") return <Badge variant="ok">done</Badge>;
  if (job.status === "error") return <Badge variant="fail">failed</Badge>;
  if (job.status === "resolving") return <Badge variant="warn">fetching</Badge>;
  if (job.status === "running" || job.status === "queued") {
    return <Badge variant="warn">{job.status}</Badge>;
  }
  return <Badge>{job.status}</Badge>;
}
