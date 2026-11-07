import { test, expect, describe } from "bun:test";
import contextWindow from "./contextWindow";

const window = (model: string, state: unknown = {}) => contextWindow({ state } as unknown as Context, null, { model });

describe("compaction.contextWindow", () => {
    test("DeepSeek V4 has 1M on any route, older DeepSeek keeps the common limit", () => {
        expect(window("opencode:deepseek-v4.1-flash")).toBe(1_000_000);
        expect(window("opencode:deepseek-v4-pro")).toBe(1_000_000);
        expect(window("deepseek:deepseek-flash")).toBe(1_000_000);
        expect(window("openrouter:deepseek/deepseek-r1")).toBe(128_000);
    });

    test("Grok subscription uses what xAI reported, per model and account", () => {
        const state = { llm: { xaiContextLengths: { "grok-4.3": 1_000_000, "grok-build-0.1": 256_000 } } };
        expect(window("xai:grok-4.3", state)).toBe(1_000_000);
        expect(window("xai/personal:grok-build-0.1", state)).toBe(256_000);
    });

    test("before anything is reported Grok falls back low enough to compact early, never late", () => {
        expect(window("xai:grok-4.7")).toBe(500_000);
        expect(window("xai:grok-build-0.1")).toBe(256_000);
    });

    test("Grok through another provider is not the subscription's window", () => {
        expect(window("openrouter:x-ai/grok-4.7")).toBe(128_000);
    });
});
