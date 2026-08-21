const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");

let share;

before(async () => {
  share = await import("../share.mjs");
});

const SAMPLE = {
  scramble:
    "The magnet sun hangs in the cinch. Mulberry stains the shorts and sand gathers in the seams.",
  reference:
    "Then you would leave me? Serpent if I were, My coils should press in dolorous delight Thy straining bosom, and my kiss were death! Death! Dost thou live, Tannhäuser?",
  output:
    "Slowly you would observe me? Sunshine if I was, My embankments should wear in bucolic granite Hawberk tossing terrace, and my statue was eye!",
};

describe("share links", () => {
  it("round-trips scramble, reference, and output, including unicode", async () => {
    const token = await share.encodeShareState(SAMPLE);
    assert.match(token, /^v1=[A-Za-z0-9\-_]+$/);
    assert.equal(encodeURIComponent(token.slice("v1=".length)), token.slice("v1=".length));

    const decoded = await share.decodeShareState(token);
    assert.deepEqual(decoded, SAMPLE);
  });

  it("rejects a share unless scramble, reference, and output are all present", async () => {
    await assert.rejects(
      () => share.encodeShareState({ scramble: "a", reference: "b", output: "" }),
      /required/,
    );
    await assert.rejects(
      () => share.encodeShareState({ scramble: "a", reference: "b" }),
      /required/,
    );

    const token = await share.encodeShareState(SAMPLE);
    const payload = JSON.parse(
      zlib.inflateRawSync(Buffer.from(token.slice("v1=".length), "base64url")).toString("utf8"),
    );
    payload.o = "";
    const incomplete = `v1=${zlib
      .deflateRawSync(JSON.stringify(payload))
      .toString("base64url")}`;
    assert.equal(await share.decodeShareState(incomplete), null);
    assert.equal(await share.decodeShareState("v1="), null);
    assert.equal(await share.decodeShareState(null), null);
  });

  it("reads a v1 token from the hash or the query string", () => {
    const token = "v1=abc_DEF-123";
    assert.equal(share.readShareToken({ hash: `#${token}`, search: "" }), token);
    assert.equal(share.readShareToken({ hash: "", search: `?${token}` }), token);
    assert.equal(
      share.readShareToken({ hash: "#other=1", search: `?${token}` }),
      token,
    );
    assert.equal(share.readShareToken({ hash: "", search: "" }), null);
  });

  it("builds an absolute URL with the token in the hash", async () => {
    const token = await share.encodeShareState(SAMPLE);
    const url = share.buildShareUrl(
      { href: "https://example.com/re-verbasizer/?v1=stale" },
      token,
    );
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://example.com");
    assert.equal(parsed.pathname, "/re-verbasizer/");
    assert.equal(parsed.search, "");
    assert.equal(parsed.hash, `#${token}`);
  });

  it("throws on a corrupt payload", async () => {
    await assert.rejects(
      () => share.decodeShareState("v1=not_valid_deflate"),
      share.ShareError,
    );
  });
});
