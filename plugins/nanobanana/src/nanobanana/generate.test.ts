import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import generate from "./generate";

const dir = `${process.cwd()}/.test-tmp/nanobanana-generate`;
const image = { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: Buffer.from("img").toString("base64") } }] } }], usageMetadata: { totalTokenCount: 1 } };

// Network stubbed at fetch; the key and the Vertex credential come from stubs that never contact Google.
const mkCtx = (apiKey: string | null) => ({ fns: {
    secrets: { getLocal: async () => apiKey },
    nanobanana: { project: async (o: { project?: string }) => o.project ?? "default-project", accessToken: async () => "vertex-token" },
    workspace: { resolve: (o: { path: string }) => o.path.startsWith("/") ? o.path : `${dir}/${o.path}` },
    files: { mkdir: async (o: { path: string }) => mkdirSync(o.path, { recursive: true }) },
} }) as unknown as Context;

describe("nanobanana.generate backend", () => {
    const realFetch = globalThis.fetch;
    let seen: { url: string; headers: Headers }[];
    beforeEach(() => {
        seen = [];
        globalThis.fetch = (async (input: any, init?: any) => {
            seen.push({ url: String(input), headers: new Headers(init?.headers) });
            return Response.json(image);
        }) as typeof fetch;
    });
    afterEach(() => {
        globalThis.fetch = realFetch;
        rmSync(dir, { recursive: true, force: true });
    });
    const run = (apiKey: string | null, opts: Record<string, unknown> = {}) => generate(mkCtx(apiKey), null, { prompt: "a banana", ...opts });

    test("a stored key selects the Gemini API, with no Cloud project", async () => {
        const result = await run("ai-key");
        expect(seen[0]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent");
        expect(seen[0]!.headers.get("x-goog-api-key")).toBe("ai-key");
        expect(seen[0]!.headers.get("authorization")).toBeNull();
        expect(result).toMatchObject({ backend: "gemini", project: null });
    });

    test("without a key the request goes to Vertex AI", async () => {
        const result = await run(null);
        expect(seen[0]!.url).toContain("https://aiplatform.googleapis.com/v1/projects/default-project/locations/global/");
        expect(seen[0]!.headers.get("authorization")).toBe("Bearer vertex-token");
        expect(seen[0]!.headers.get("x-goog-api-key")).toBeNull();
        expect(result).toMatchObject({ backend: "vertex", project: "default-project" });
    });

    test("a project or location is honoured over a stored key", async () => {
        expect(await run("ai-key", { project: "billed" })).toMatchObject({ backend: "vertex", project: "billed" });
        expect(seen[0]!.url).toContain("/projects/billed/");
        await run("ai-key", { location: "europe-west4" });
        expect(seen[1]!.url).toContain("https://europe-west4-aiplatform.googleapis.com/");
    });

    test("backend vertex ignores a stored key", async () => {
        expect(await run("ai-key", { backend: "vertex" })).toMatchObject({ backend: "vertex" });
        expect(seen[0]!.headers.get("x-goog-api-key")).toBeNull();
    });

    test("backend gemini fails rather than falling back to another bill", async () => {
        await expect(run(null, { backend: "gemini" })).rejects.toThrow("not configured");
        await expect(run("ai-key", { backend: "gemini", project: "billed" })).rejects.toThrow("Vertex AI only");
        expect(seen).toEqual([]);
    });

    test("errors name the API that failed", async () => {
        globalThis.fetch = (async () => Response.json({ error: { message: "nope" } }, { status: 403 })) as unknown as typeof fetch;
        await expect(run("ai-key")).rejects.toThrow("Gemini API 403: nope");
        await expect(run(null)).rejects.toThrow("Vertex AI 403: nope");
    });
});
