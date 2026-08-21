const VERSION = 1;
const HASH_PREFIX = `v${VERSION}=`;
const MAX_INFLATED_BYTES = 512 * 1024;

// Share links are `#v1=<base64url(deflate-raw(utf8({s,r,o})))>`.
// All three fields must be present or the link is ignored.

export class ShareError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ShareError";
  }
}

export function isShareStateComplete(state) {
  return (
    isPresent(state?.scramble) &&
    isPresent(state?.reference) &&
    isPresent(state?.output)
  );
}

export async function encodeShareState(state) {
  if (!isShareStateComplete(state)) {
    throw new ShareError("Scramble, reference, and output are all required.");
  }

  const json = JSON.stringify({
    s: state.scramble,
    r: state.reference,
    o: state.output,
  });
  const compressed = await deflateRaw(new TextEncoder().encode(json));
  return HASH_PREFIX + bytesToBase64Url(compressed);
}

export async function decodeShareState(token) {
  if (typeof token !== "string" || !token.startsWith(HASH_PREFIX)) {
    return null;
  }

  const encoded = token.slice(HASH_PREFIX.length);
  if (!encoded) {
    return null;
  }

  let json;
  try {
    const inflated = await inflateRaw(base64UrlToBytes(encoded));
    json = new TextDecoder().decode(inflated);
  } catch (cause) {
    throw new ShareError("Shared link is not valid.", { cause });
  }

  let data;
  try {
    data = JSON.parse(json);
  } catch (cause) {
    throw new ShareError("Shared link is not valid.", { cause });
  }

  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new ShareError("Shared link is not valid.");
  }

  const state = {
    scramble: data.s,
    reference: data.r,
    output: data.o,
  };
  return isShareStateComplete(state) ? state : null;
}

export function readShareToken(locationLike) {
  const hash = String(locationLike?.hash || "").replace(/^#/, "");
  if (hash.startsWith(HASH_PREFIX)) {
    return hash;
  }

  const fromHash = new URLSearchParams(hash).get("v1");
  if (fromHash) {
    return HASH_PREFIX + fromHash;
  }

  const fromSearch = new URLSearchParams(locationLike?.search || "").get("v1");
  if (fromSearch) {
    return HASH_PREFIX + fromSearch;
  }

  return null;
}

export function buildShareUrl(locationLike, token) {
  const url = new URL(locationLike.href);
  url.searchParams.delete("v1");
  url.hash = token;
  return url.toString();
}

function isPresent(value) {
  return typeof value === "string" && value.length > 0;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64UrlToBytes(text) {
  if (!/^[A-Za-z0-9\-_]*$/u.test(text)) {
    throw new Error("Invalid encoding");
  }

  const padLength = (4 - (text.length % 4)) % 4;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLength);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function deflateRaw(bytes) {
  if (supportsRawDeflateStream()) {
    return transformBytes(bytes, new CompressionStream("deflate-raw"));
  }

  const zlib = await import("node:zlib");
  const { promisify } = await import("node:util");
  return new Uint8Array(await promisify(zlib.deflateRaw)(bytes, { level: 9 }));
}

async function inflateRaw(bytes) {
  if (supportsRawDeflateStream()) {
    return transformBytes(
      bytes,
      new DecompressionStream("deflate-raw"),
      MAX_INFLATED_BYTES,
    );
  }

  const zlib = await import("node:zlib");
  const { promisify } = await import("node:util");
  const inflated = await promisify(zlib.inflateRaw)(bytes, {
    maxOutputLength: MAX_INFLATED_BYTES,
  });
  return new Uint8Array(inflated);
}

let rawDeflateStreamSupport;

function supportsRawDeflateStream() {
  if (rawDeflateStreamSupport !== undefined) {
    return rawDeflateStreamSupport;
  }
  if (typeof CompressionStream !== "function" || typeof DecompressionStream !== "function") {
    rawDeflateStreamSupport = false;
    return rawDeflateStreamSupport;
  }
  try {
    new CompressionStream("deflate-raw");
    new DecompressionStream("deflate-raw");
    rawDeflateStreamSupport = true;
  } catch {
    rawDeflateStreamSupport = false;
  }
  return rawDeflateStreamSupport;
}

async function transformBytes(bytes, stream, maxBytes = Infinity) {
  const compressed = new Blob([bytes]).stream().pipeThrough(stream);
  const reader = compressed.getReader();
  const chunks = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        throw new ShareError("Shared link is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
