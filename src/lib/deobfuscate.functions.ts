import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const pluginSchema = z.enum(["auto", "luraph_v15", "ironbrew1", "generic"]);
const modeSchema = z.enum(["deobfuscate", "detect"]);

const startSchema = z.object({
  source: z.string().max(8_000_000),
  url: z.string().max(8000).optional(),
  scriptKey: z.string().max(500).optional(),
  filename: z.string().max(180).optional(),
  plugin: pluginSchema,
  mode: modeSchema,
  noDevirt: z.boolean(),
  strings: z.boolean(),
  timeout: z.number().int().min(15).max(300),
});

const fetchSchema = z.object({
  source: z.string().max(8_000_000).optional(),
  url: z.string().max(8000).optional(),
  scriptKey: z.string().max(500).optional(),
});

export const getRuntimeStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const { runtimeStatus } = await import("./deobfuscate.server");
  return runtimeStatus();
});

export const loadSampleFn = createServerFn({ method: "GET" }).handler(async () => {
  const { loadSampleSource } = await import("./deobfuscate.server");
  return { filename: "001_vm_like_dispatch-obfuscated.lua", source: loadSampleSource() };
});

export const fetchLoadstringFn = createServerFn({ method: "POST" })
  .validator(fetchSchema)
  .handler(async ({ data }) => {
    const { resolveSource } = await import("./loadstring.server");
    return resolveSource({
      source: data.source ?? "",
      url: data.url,
      scriptKey: data.scriptKey,
    });
  });

export const startDeobfuscateFn = createServerFn({ method: "POST" })
  .validator(startSchema)
  .handler(async ({ data }) => {
    const { startJob } = await import("./deobfuscate.server");
    return startJob(data);
  });

export const pollJobFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().min(1),
      cursor: z.number().int().min(0).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { getJob } = await import("./deobfuscate.server");
    const job = getJob(data.id, data.cursor ?? 0);
    if (!job) throw new Error("Job not found. It may have expired.");
    return job;
  });
