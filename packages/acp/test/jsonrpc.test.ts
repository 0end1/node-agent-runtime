import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  JsonRpcError,
  LineDecoder,
  PARSE_ERROR,
  encodeMessage,
  isRequest,
  isResponse,
  parseMessage,
} from "../src/jsonrpc.js";

describe("jsonrpc — wire framing", () => {
  it("encodes one message per line with no embedded newlines", () => {
    const frame = encodeMessage({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "a\nb" } } },
    });
    assert.ok(frame.endsWith("\n"));
    // ACP forbids literal newlines inside a message: only the terminator remains.
    assert.equal(frame.trimEnd().includes("\n"), false);
    assert.equal(frame.split("\n").filter((l) => l.length > 0).length, 1);
  });

  it("decodes partial chunks across writes", () => {
    const decoder = new LineDecoder();
    assert.deepEqual(decoder.push('{"a":1}\n{"b":2}\n'), ['{"a":1}', '{"b":2}']);
    assert.deepEqual(decoder.push('{"c":3'), []);
    assert.deepEqual(decoder.push("}\n"), ['{"c":3}']);
  });

  it("rejects malformed payloads with a parse error", () => {
    assert.throws(() => parseMessage("{oops"), (error: Error) => {
      assert.ok(error instanceof JsonRpcError);
      assert.equal(error.code, PARSE_ERROR);
      return true;
    });
    assert.throws(() => parseMessage('{"jsonrpc":"1.0"}'), /jsonrpc/);
  });

  it("distinguishes requests from responses", () => {
    const request = parseMessage('{"jsonrpc":"2.0","id":1,"method":"initialize"}');
    const response = parseMessage('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1}}');
    const notification = parseMessage('{"jsonrpc":"2.0","method":"session/cancel"}');
    assert.equal(isRequest(request), true);
    assert.equal(isResponse(request), false);
    assert.equal(isResponse(response), true);
    assert.equal(isRequest(notification), false);
    assert.equal(isResponse(notification), false);
  });
});
