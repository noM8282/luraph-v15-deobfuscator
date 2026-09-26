import {
  classifyUrl,
  extractAnyUrl,
  extractHttpGetUrls,
  extractScriptKey,
  isHtmlPayload,
  isLuraphV15,
  looksLikeBareUrl,
  looksLikeLoaderStub,
  luarmorAlternates,
  MAX_FETCH_HOPS,
  MAX_SOURCE_BYTES,
  rewriteSourceUrl,
  type SourceKind,
} from "./loadstring";

export type FetchStep = {
  url: string;
  kind: SourceKind;
  bytes: number;
  note: string;
};

export type ResolvedSource = {
  source: string;
  kind: SourceKind;
  scriptKey?: string;
  chain: FetchStep[];
};

const FETCH_TIMEOUT_MS = 45_000;

const USER_AGENTS = [
  "Roblox/WinInet",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) syn-httpget",
];

function assertSize(bytes: number, where: string) {
  if (bytes > MAX_SOURCE_BYTES) {
    throw new Error(`${where} is larger than 8 MB — too big to deobfuscate here.`);
  }
}

async function fetchOnce(
  url: string,
  userAgent: string,
  extraHeaders: Record<string, string>,
): Promise<{ status: number; body: string; finalUrl: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        Accept: "*/*",
        "User-Agent": userAgent,
        "Accept-Language": "en-US,en;q=0.9",
        ...extraHeaders,
      },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    assertSize(buf.byteLength, url);
    return {
      status: res.status,
      body: buf.toString("latin1"),
      finalUrl: res.url || url,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRemote(
  url: string,
  scriptKey: string | undefined,
): Promise<{ body: string; usedUrl: string; note: string }> {
  const kind = classifyUrl(url);
  const candidates = kind === "luarmor" ? luarmorAlternates(url) : [url];
  const extra: Record<string, string> = {};
  if (scriptKey) {
    extra["X-Script-Key"] = scriptKey;
    extra["script-key"] = scriptKey;
  }

  let lastError = "Could not fetch remote script.";
  for (const candidate of candidates) {
    for (const ua of kind === "luarmor" ? USER_AGENTS : [USER_AGENTS[0]]) {
      try {
        const result = await fetchOnce(candidate, ua, extra);
        if (result.status >= 400) {
          lastError = `${candidate} returned HTTP ${result.status}`;
          continue;
        }
        if (!result.body.trim()) {
          lastError = `${candidate} returned an empty body`;
          continue;
        }
        if (isHtmlPayload(result.body)) {
          lastError = `${candidate} returned a browser page instead of Lua`;
          continue;
        }
        const note =
          candidate === url
            ? `Fetched ${kind} (${result.body.length} bytes)`
            : `Fetched via ${candidate} (${result.body.length} bytes)`;
        return { body: result.body, usedUrl: result.finalUrl, note };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
  }
  throw new Error(lastError);
}

function nextUrls(source: string, fallback?: string): string[] {
  const urls = extractHttpGetUrls(source).map(rewriteSourceUrl);
  const bare = looksLikeBareUrl(source);
  if (bare) urls.unshift(rewriteSourceUrl(bare));
  const fromSource = extractAnyUrl(source);
  if (fromSource) urls.push(fromSource);
  if (fallback) {
    const extracted = extractAnyUrl(fallback);
    if (extracted) urls.unshift(extracted);
  }
  return [...new Set(urls)];
}

export async function resolveSource(input: {
  source: string;
  url?: string;
  scriptKey?: string;
}): Promise<ResolvedSource> {
  let source = input.source ?? "";
  let explicitUrl = input.url?.trim() || undefined;
  const chain: FetchStep[] = [];
  let scriptKey = input.scriptKey?.trim() || extractScriptKey(source) || extractScriptKey(explicitUrl ?? "");
  let kind: SourceKind = "paste";

  if (explicitUrl && !/^https?:\/\//i.test(explicitUrl)) {
    const extracted = extractAnyUrl(explicitUrl);
    if (extracted) {
      explicitUrl = extracted;
    } else {
      source = source ? `${explicitUrl}\n${source}` : explicitUrl;
      explicitUrl = extractAnyUrl(source) || undefined;
    }
  } else if (explicitUrl) {
    explicitUrl = rewriteSourceUrl(explicitUrl);
  }

  const startUrls = nextUrls(source, explicitUrl);
  const shouldFetch =
    Boolean(explicitUrl) || looksLikeLoaderStub(source) || Boolean(looksLikeBareUrl(source));

  if (!shouldFetch || startUrls.length === 0) {
    if (!source.trim()) {
      throw new Error("Paste a script, a loadstring, or a GitHub / Luarmor URL first.");
    }
    return { source, kind, scriptKey, chain };
  }

  const seen = new Set<string>();
  let hops = 0;
  let currentUrls = startUrls;

  while (hops < MAX_FETCH_HOPS && currentUrls.length > 0) {
    const url = currentUrls.find((u) => !seen.has(u));
    if (!url) break;
    seen.add(url);
    hops += 1;
    kind = classifyUrl(url);
    const fetched = await fetchRemote(url, scriptKey);
    chain.push({
      url: fetched.usedUrl,
      kind,
      bytes: fetched.body.length,
      note: fetched.note,
    });
    source = fetched.body;
    const nestedKey = extractScriptKey(source);
    if (nestedKey && !scriptKey) scriptKey = nestedKey;

    if (isLuraphV15(source) || !looksLikeLoaderStub(source)) {
      break;
    }
    currentUrls = nextUrls(source);
  }

  if (scriptKey && !SCRIPT_KEY_ALREADY.test(source)) {
    source = `script_key = ${JSON.stringify(scriptKey)}\n${source}`;
  }

  if (!source.trim()) {
    throw new Error("The remote script was empty.");
  }
  return { source, kind, scriptKey, chain };
}

const SCRIPT_KEY_ALREADY = /^\s*script_key\s*=/m;
