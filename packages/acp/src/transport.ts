import type { Readable, Writable } from "node:stream";
import {
  JsonRpcError,
  LineDecoder,
  encodeMessage,
  parseMessage,
  type JsonRpcMessage,
} from "./jsonrpc.js";

/**
 * The transport contract of an ACP connection: newline-delimited JSON-RPC in,
 * newline-delimited JSON-RPC out.
 */
export interface AcpTransport {
  start(): void;
  send(message: JsonRpcMessage): void;
  onMessage(listener: (message: JsonRpcMessage) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  close(): void;
}

export interface StdioTransportOptions {
  stdin?: Readable;
  stdout?: Writable;
  /** Diagnostics sink. Must never be stdout — it is reserved for ACP messages. */
  logger?: (line: string) => void;
}

/**
 * stdio transport: reads ACP messages from stdin, writes them to stdout.
 *
 * Defaults to the process streams. Injectable so tests (and alternative
 * transports) can drive the same connection without spawning a subprocess.
 */
export class StdioTransport implements AcpTransport {
  private readonly decoder = new LineDecoder();
  private readonly messageListeners = new Set<(message: JsonRpcMessage) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly stdin: Readable;
  private readonly stdout: Writable;
  private readonly logger?: (line: string) => void;
  private started = false;

  constructor(options: StdioTransportOptions = {}) {
    this.stdin = options.stdin ?? process.stdin;
    this.stdout = options.stdout ?? process.stdout;
    this.logger = options.logger;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stdin.setEncoding("utf8");
    this.stdin.on("data", (chunk: string | Buffer) => this.ingest(chunk.toString()));
    this.stdin.on("error", (error: Error) => this.fail(error));
  }

  send(message: JsonRpcMessage): void {
    this.stdout.write(encodeMessage(message));
  }

  onMessage(listener: (message: JsonRpcMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  close(): void {
    this.messageListeners.clear();
    this.errorListeners.clear();
  }

  private ingest(chunk: string): void {
    for (const line of this.decoder.push(chunk)) {
      try {
        const message = parseMessage(line);
        for (const listener of [...this.messageListeners]) listener(message);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private fail(error: Error): void {
    this.logger?.(`[acp] transport error: ${error.message}`);
    if (this.errorListeners.size === 0) {
      // A parse error with no listener would otherwise be swallowed silently.
      if (error instanceof JsonRpcError) {
        this.send({
          jsonrpc: "2.0",
          id: 0,
          error: error.toObject(),
        });
      }
      return;
    }
    for (const listener of [...this.errorListeners]) listener(error);
  }
}

/**
 * In-memory transport pair — the two ends of one connection, no subprocess.
 * Used by tests and as the reference for custom transports.
 */
export class MemoryTransportPair {
  readonly agent: AcpTransport;
  readonly client: AcpTransport;

  constructor() {
    const ends = [new MemoryEnd(), new MemoryEnd()];
    this.agent = ends[0];
    this.client = ends[1];
    ends[0].pipeTo(ends[1]);
    ends[1].pipeTo(ends[0]);
  }
}

class MemoryEnd implements AcpTransport {
  private readonly decoder = new LineDecoder();
  private peer?: MemoryEnd;
  private readonly messageListeners = new Set<(message: JsonRpcMessage) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();

  pipeTo(peer: MemoryEnd): void {
    this.peer = peer;
  }

  start(): void {
    /* nothing to pump: send() delivers synchronously */
  }

  send(message: JsonRpcMessage): void {
    this.peer?.receive(encodeMessage(message));
  }

  receive(chunk: string): void {
    for (const line of this.decoder.push(chunk)) {
      try {
        const message = parseMessage(line);
        for (const listener of [...this.messageListeners]) listener(message);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        for (const listener of [...this.errorListeners]) listener(err);
      }
    }
  }

  onMessage(listener: (message: JsonRpcMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  close(): void {
    this.messageListeners.clear();
    this.errorListeners.clear();
    this.peer = undefined;
  }
}
