import { test, expect, describe } from "bun:test";
import resolveEndpoint from "./resolveEndpoint";
import stream from "./streamOpenAI";
import call from "./call";
import parseSSE from "./parseSSE";
import getString from "../settings/getString";
import get from "../settings/get";
import resolveSecret from "../secrets/resolve";
import resolveSetting from "../secrets/resolveSetting";
import opencodeApiKey from "./$setting_opencodeApiKey";

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
