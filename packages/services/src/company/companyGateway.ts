import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { CompanyRefusal, companyRoots } from "./companyPolicy.js";
import type { CompanyStore } from "./companyStore.js";
import { clip } from "./companyFiles.js";
import { companyToolsFor, type CompanyToolContext } from "./companyTools.js";

const MAX_BODY_BYTES = 8 * 1024 * 1024;

export interface CompanyGatewayRun {
  runId: string;
  agentId: string;
  depth: number;
  channel: string;
  /** 唤醒这次运行的同事；没有 hand-off 权限的同事仍可 @它 回话。 */
  requestedBy?: string;
  /** 这次运行是在回答 requestedBy 的提问：它不能再 @ 回去（防止互相确认/道谢的来回）。 */
  answering?: boolean;
}

export interface CompanyGatewayDeps {
  store: CompanyStore;
  startDelegateRun: CompanyToolContext["startDelegateRun"];
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

/**
 * 同事唯一能接触文件与命令的入口（OpenBot 的 gateway）。
 *
 * 一个 host 进程一个实例，只监听 127.0.0.1 的随机端口；每次运行注册一个独立 token，
 * URL 里的 runId 与 token 绑定同事身份，同事无法冒充别人或越过自己的文件夹授权。
 * 先裁决、再写审计、最后才执行。
 */
export class CompanyGateway {
  private server: Server | undefined;
  private port = 0;
  private readonly runs = new Map<string, CompanyGatewayRun & { token: Buffer }>();

  constructor(private readonly deps: CompanyGatewayDeps) {}

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => {
      void this.handle(req, res).catch((error: unknown) => {
        if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String((error as Error)?.message ?? error) }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    server.unref();
    this.server = server;
    this.port = (server.address() as AddressInfo).port;
  }

  /** 为一次运行签发 MCP 端点（URL + Authorization 头）。 */
  register(run: CompanyGatewayRun): { url: string; authorization: string } {
    if (!this.server) throw new Error("Company gateway is not running.");
    const token = randomBytes(32);
    this.runs.set(run.runId, { ...run, token });
    return {
      url: `http://127.0.0.1:${this.port}/mcp/${encodeURIComponent(run.runId)}`,
      authorization: `Bearer ${token.toString("base64url")}`,
    };
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.runs.clear();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private authenticate(req: IncomingMessage): (CompanyGatewayRun & { token: Buffer }) | undefined {
    const match = /^\/mcp\/([^/?]+)/.exec(req.url ?? "");
    const run = match ? this.runs.get(decodeURIComponent(match[1]!)) : undefined;
    const presented = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ""))?.[1];
    if (!run || !presented) return undefined;
    const given = Buffer.from(presented, "base64url");
    return given.length === run.token.length && timingSafeEqual(given, run.token) ? run : undefined;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 浏览器请求一定带 Origin；MCP 客户端不带。拒绝任何网页借本机端口驱动同事。
    if (req.headers.origin) return void res.writeHead(403).end();
    const run = this.authenticate(req);
    if (!run) return void res.writeHead(401).end();
    if (req.method === "GET") return void res.writeHead(405, { allow: "POST, DELETE" }).end();
    if (req.method === "DELETE") return void res.writeHead(200).end();
    if (req.method !== "POST") return void res.writeHead(405).end();

    const body = await readBody(req);
    const messages = Array.isArray(body) ? (body as JsonRpcRequest[]) : [body as JsonRpcRequest];
    const replies = (await Promise.all(messages.map((m) => this.dispatch(run, m)))).filter(
      (r): r is Record<string, unknown> => r !== undefined,
    );
    if (replies.length === 0) return void res.writeHead(202).end();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(Array.isArray(body) ? replies : replies[0]));
  }

  private async dispatch(
    run: CompanyGatewayRun,
    msg: JsonRpcRequest,
  ): Promise<Record<string, unknown> | undefined> {
    if (msg.id === undefined || msg.id === null) return undefined; // notification
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
    switch (msg.method) {
      case "initialize":
        return reply({
          protocolVersion: String(msg.params?.protocolVersion ?? "2025-06-18"),
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "zcode-company", version: "1.0.0" },
        });
      case "ping":
        return reply({});
      case "tools/list": {
        const agent = await this.deps.store.getAgent(run.agentId);
        const tools = agent ? companyToolsFor(agent) : [];
        return reply({
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: { readOnlyHint: Boolean(t.readOnly) },
          })),
        });
      }
      case "tools/call":
        return reply(await this.callTool(run, msg.params ?? {}));
      default:
        return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
    }
  }

  private async callTool(run: CompanyGatewayRun, params: Record<string, unknown>) {
    const name = String(params.name ?? "");
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const store = this.deps.store;
    const agent = await store.getAgent(run.agentId);
    const tool = agent ? companyToolsFor(agent).find((t) => t.name === name) : undefined;
    const target = tool?.target?.(args)?.slice(0, 300);
    const audit = (decision: "allowed" | "refused" | "failed", detail?: string) =>
      store.appendAudit({ ts: Date.now(), agentId: run.agentId, runId: run.runId, tool: name, target, decision, detail });

    if (!agent || !tool) {
      await audit("refused", "Tool not granted to this coworker.");
      return errorResult(`The tool "${name}" is not available to you.`);
    }
    const ownFolder = store.workspaceOf(agent.id);
    const ctx: CompanyToolContext = {
      ...run,
      agent,
      roster: await store.listAgents(),
      roots: companyRoots(agent, ownFolder),
      ownFolder,
      store,
      startDelegateRun: this.deps.startDelegateRun,
    };
    try {
      const out = await tool.run(args, ctx);
      await audit("allowed");
      const text = typeof out === "string" ? out : JSON.stringify(out, null, 2);
      return { content: [{ type: "text", text: clip(text, 60_000) }] };
    } catch (error) {
      const refused = error instanceof CompanyRefusal;
      const message = String((error as Error)?.message ?? error);
      await audit(refused ? "refused" : "failed", message.slice(0, 500));
      return errorResult(message);
    }
  }
}

function errorResult(text: string) {
  return { content: [{ type: "text", text }], isError: true };
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}
