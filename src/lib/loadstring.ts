/** Client-safe URL / loader detection for GitHub + Luarmor loadstrings. */

export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_FETCH_HOPS = 6;

const HTTP_GET_RE =
  /(?:game\s*:\s*)?HttpGet(?:Async)?\s*\(\s*["'`](https?:\/\/[^"'`]+)["'`]/gi;
const BARE_URL_RE = /^\s*(https?:\/\/[^\s]+)\s*$/i;
const SCRIPT_KEY_RE = /script_key\s*=\s*["'`]([^"'`]+)["'`]/i;
const LURAPH_HEADER_RE = /Luraph Obfuscator v15/i;
const LURAPH_SHAPE_RE = /\[\d+\]\s*=\s*(bit32|buffer|string|table|math)\.\w+/;

export type SourceKind = "paste" | "github" | "luarmor" | "url";

export function extractScriptKey(source: string): string | undefined {
  const m = SCRIPT_KEY_RE.exec(source);
  return m?.[1]?.trim() || undefined;
}

export function extractHttpGetUrls(source: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  HTTP_GET_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HTTP_GET_RE.exec(source))) {
    const url = m[1].trim();
    if (!seen.has(url)) {
      seen.add(url);
      found.push(url);
    }
  }
  return found;
}

export function extractAnyUrl(text: string): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  const bare = looksLikeBareUrl(trimmed);
  if (bare) return rewriteSourceUrl(bare);
  const fromGet = extractHttpGetUrls(trimmed)[0];
  if (fromGet) return rewriteSourceUrl(fromGet);
  const m = /https?:\/\/[^\s"'`<>)\]]+/i.exec(trimmed);
  return m ? rewriteSourceUrl(m[0]) : null;
}

export function looksLikeBareUrl(source: string): string | null {
  const m = BARE_URL_RE.exec(source.trim());
  return m ? m[1].replace(/[),;]+$/, "") : null;
}

export function isLuraphV15(source: string): boolean {
  const head = source.slice(0, 800);
  if (LURAPH_HEADER_RE.test(head)) return true;
  const start = source.trimStart().slice(0, 2500);
  return start.startsWith("return setmetatable({") && LURAPH_SHAPE_RE.test(start);
}

export function looksLikeLoaderStub(source: string): boolean {
  if (!source.trim()) return false;
  if (isLuraphV15(source)) return false;
  if (looksLikeBareUrl(source)) return true;
  if (source.length > 12_000) return false;
  const lower = source.toLowerCase();
  const hasLoad = /loadstring\s*\(/i.test(source) || /httpget/i.test(source);
  const remote =
    lower.includes("luarmor.net") ||
    lower.includes("raw.githubusercontent.com") ||
    lower.includes("gist.githubusercontent.com") ||
    lower.includes("github.com/");
  return hasLoad && (remote || extractHttpGetUrls(source).length > 0);
}

export function classifyUrl(url: string): SourceKind {
  const u = url.toLowerCase();
  if (u.includes("luarmor.net")) return "luarmor";
  if (
    u.includes("github.com") ||
    u.includes("githubusercontent.com") ||
    u.includes("gist.github.com")
  ) {
    return "github";
  }
  return "url";
}

export function rewriteSourceUrl(raw: string): string {
  let url = raw.trim();
  try {
    url = decodeURIComponent(url);
  } catch {
    // keep raw
  }
  url = url.replace(/[),.;]+$/g, "");

  const blob = url.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/(.+?)(?:\?.*)?$/i,
  );
  if (blob) {
    return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}/${blob[4]}`;
  }

  const gist = url.match(
    /^https?:\/\/gist\.github\.com\/(?:[^/]+\/)?([a-f0-9]+)(?:\.lua)?(?:\/.*)?$/i,
  );
  if (gist) {
    return `https://gist.githubusercontent.com/raw/${gist[1]}`;
  }

  const gistRaw = url.match(
    /^https?:\/\/gist\.github\.com\/([^/]+)\/([a-f0-9]+)\/raw(?:\/(.+))?$/i,
  );
  if (gistRaw) {
    const rest = gistRaw[3] ? `/${gistRaw[3]}` : "";
    return `https://gist.githubusercontent.com/${gistRaw[1]}/${gistRaw[2]}/raw${rest}`;
  }

  // Luarmor v3 loaders sometimes 404 while v4 works, and vice versa.
  return url;
}

export function luarmorAlternates(url: string): string[] {
  const out = [url];
  if (!/luarmor\.net/i.test(url)) return out;
  const swapped = url.includes("/files/v3/")
    ? url.replace("/files/v3/", "/files/v4/")
    : url.includes("/files/v4/")
      ? url.replace("/files/v4/", "/files/v3/")
      : null;
  if (swapped) out.push(swapped);
  if (url.endsWith(".lua")) out.push(url.replace(/\.lua$/i, ""));
  const id = url.match(/\/loaders\/([a-f0-9]+)/i)?.[1];
  if (id) {
    out.push(`https://api.luarmor.net/files/v3/loaders/${id}.lua`);
    out.push(`https://api.luarmor.net/files/v4/loaders/${id}.lua`);
  }
  return [...new Set(out)];
}

export function isHtmlPayload(body: string): boolean {
  const start = body.trimStart().slice(0, 200).toLowerCase();
  return (
    start.startsWith("<!doctype") ||
    start.startsWith("<html") ||
    start.includes("cannot be displayed on browser") ||
    start.includes("<head>")
  );
}
