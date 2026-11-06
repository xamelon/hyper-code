import { test, expect, describe } from "bun:test";
import resolveEndpoint from "./resolveEndpoint";
import stream from "./streamOpenAI";
import call from "./call";
import parseSSE from "./parseSSE";
import classifyError from "./classifyError";
import getString from "../settings/getString";
import get from "../settings/get";
import resolveSecret from "../secrets/resolve";
import resolveSetting from "../secrets/resolveSetting";
import opencodeApiKey from "./$setting_opencodeApiKey";
import { mkTestCtx } from "../_testCtx.entry";

// Plain-object ctx, no database: the real endpoint table and settings fns, with
// the network stubbed at connectFetch.
const mkCtx = (env: Record<string, string> = { OPENCODE_API_KEY: "oc-key" }) => {
    const ctx: any = { env, state: { settings: { registry: new Map([["llm.opencodeApiKey", opencodeApiKey]]) } } };
    ctx.fns = {
        procs: { db: { select: async () => [] } },
        settings: {
            getString: (opts: any) => getString(ctx, null, opts),
            get: (opts: any) => get(ctx, null, opts),
            files: async () => ({ values: {} }),
        },
        secrets: {
            resolve: (opts: any) => resolveSecret(ctx, null, opts),
            resolveSetting: (opts: any) => resolveSetting(ctx, null, opts),
            get: (opts: any) => resolveSecret(ctx, null, opts),
        },
        agent: {
            buildLlmRequest: async () => ({ system: null, messages: [] }),
            cacheRoot: async () => "root-agent",
            wireTools: () => [],
        },
        llm: {
            resolveEndpoint: (opts: any) => resolveEndpoint(ctx, null, opts),
            parseSSE: (opts: any) => parseSSE(ctx, null, opts),
            toOpenAIMessages: () => [],
        },
    };
    return ctx;
};

const sse = (...chunks: any[]) => new Response(
    [...chunks.map(c => `data: ${JSON.stringify(c)}\n\n`), "data: [DONE]\n\n"].join(""),
    { status: 200, headers: { "content-type": "text/event-stream" } },
);
const delta = (d: any) => ({ choices: [{ delta: d }] });

describe("opencode as a subscription", () => {
    const page = async (ctx: any) => (await ctx.fns.procs.http.dispatch({ method: "GET", url: "/llms" })).text();
    const apiProviders = (html: string) => html.slice(html.indexOf("API providers</h2>"));

    test("without a key there is no account and the section offers to add one", async () => {
        const ctx: any = await mkTestCtx();
        ctx.env.OPENCODE_API_KEY = "";
        expect((await ctx.fns.llm.listAccounts({})).some((a: any) => a.provider === "opencode")).toBe(false);
        const html = await page(ctx);
        expect(html).toContain('data-provider="opencode"');
        expect(html).toContain("Add key");
    });

    test("with a key it is one Go account next to Claude and Codex, not an API provider", async () => {
        const ctx: any = await mkTestCtx();
        ctx.env.OPENCODE_API_KEY = "oc-key";
        const account = (await ctx.fns.llm.listAccounts({ provider: "opencode" }))[0];
        expect(account).toMatchObject({ provider: "opencode", account: "default", source: "key", planType: "Go", available: true, usedPercent: null, needsReconnect: false });
        const html = await page(ctx);
        expect(html).toContain("Manage key");
        expect(html).toContain("usage unavailable");
        expect(html).not.toContain("oc-key");
        expect(apiProviders(html)).not.toContain("OpenCode");
        expect((await ctx.fns.llm.listModels({ skipNodes: true })).opencode).toContain("opencode:glm-5.3");
    });

    test("a 429 is not parked as a spent subscription: kind stays api", async () => {
        const ep: any = await resolveEndpoint(mkCtx(), null, { model: "opencode:glm-5.3" });
        const body = JSON.stringify({ error: { code: "usage_limit_reached", message: "usage limit reached" } });
        const reply = (kind: "api" | "subscription") => classifyError({} as Context, null, { provider: "opencode", account: "default", kind, status: 429, body });
        expect(reply("subscription").kind).toBe("usage_limit");   // what kind: "subscription" would do
        expect(reply(ep.kind).kind).not.toBe("usage_limit");
    });
});

describe("opencode provider", () => {
    test("resolves to the flat-rate Go route with the declared key", async () => {
        const ep: any = await resolveEndpoint(mkCtx(), null, { model: "opencode:glm-5.3" });
        expect(ep.provider).toBe("opencode");
        expect(ep.modelId).toBe("glm-5.3");
        expect(ep.apiKey).toBe("oc-key");
        expect(ep.url.startsWith("https://opencode.ai/inference/go/v1/")).toBe(true);
    });

    test("streaming names the client and the conversation", async () => {
        const ctx = mkCtx();
        let seen: any;
        ctx.fns.llm.connectFetch = async (o: any) => { seen = o; return sse(delta({ content: "ok" })); };
        const result = await stream(ctx, null, { agent: { id: "a1", model: "opencode:glm-5.3" } as any });
        const headers = new Headers(seen.init.headers);
        expect(result.text).toBe("ok");
        expect(headers.get("authorization")).toBe("Bearer oc-key");
        expect(headers.get("user-agent")).toBe("hyper-agent/1.0");
        expect(headers.get("x-opencode-session")).toBe("root-agent");
    });

    test("other OpenAI-compatible providers do not get the OpenCode headers", async () => {
        const ctx = mkCtx();
        ctx.fns.llm.resolveEndpoint = async () => ({ api: "openai", provider: "openrouter", modelId: "m", url: "https://example.test", apiKey: "k" });
        let seen: any;
        ctx.fns.llm.connectFetch = async (o: any) => { seen = o; return sse(delta({ content: "ok" })); };
        await stream(ctx, null, { agent: { id: "a1", model: "openrouter:m" } as any });
        const headers = new Headers(seen.init.headers);
        expect(headers.get("x-opencode-session")).toBeNull();
        expect(headers.get("user-agent")).toBeNull();
    });

    test("thinking is read from both reasoning_content and reasoning", async () => {
        const ctx = mkCtx();
        ctx.fns.llm.connectFetch = async () => sse(delta({ reasoning_content: "a" }), delta({ reasoning: "b" }), delta({ content: "ok" }));
        const events: string[] = [];
        const result: any = await stream(ctx, null, {
            agent: { id: "a1", model: "opencode:kimi-k3" } as any,
            onEvent: (ev: any) => { if (ev.type === "thinking_delta") events.push(ev.delta); },
        });
        expect(events).toEqual(["a", "b"]);
        expect(result.thinking).toBe("ab");
    });

    test("one-shot calls send a session id, the caller's when given", async () => {
        const previousFetch = globalThis.fetch;
        const sessions: (string | null)[] = [];
        globalThis.fetch = (async (_url: any, init: any) => {
            sessions.push(new Headers(init.headers).get("x-opencode-session"));
            return Response.json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
        }) as any;
        try {
            const ctx: any = { fns: { llm: { resolveEndpoint: async () => ({ api: "openai", provider: "opencode", modelId: "glm-5.3", url: "https://example.test", apiKey: "k" }) } } };
            await call(ctx, null, { user: "hi", model: "opencode:glm-5.3", sessionId: "s1", noFallback: true });
            await call(ctx, null, { user: "hi", model: "opencode:glm-5.3", noFallback: true });
            expect(sessions[0]).toBe("s1");
            expect(sessions[1]?.length).toBeGreaterThan(0);
        } finally { globalThis.fetch = previousFetch; }
    });
});
