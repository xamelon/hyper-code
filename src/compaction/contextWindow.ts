/**
 * Returns the known input context window of a model in tokens
 *
 * Maps a provider-qualified model id to a conservative input context window (Claude 200K, Codex/GPT-5+ 272K, long-context families and DeepSeek V4 1M, Grok subscription as reported by xAI, common open models 128K). Returns null when unknown. Use to derive auto-compaction thresholds as a fraction of the model window.
 * @param opts.model Provider-qualified model such as `claude-code:claude-opus-5` or `codex:gpt-5.6-sol`.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Provider-qualified model such as `claude-code:claude-opus-5` or `codex:gpt-5.6-sol`. */
        model: string;
    },
): number | null {
    const m = String(opts.model ?? "").toLowerCase();
    const id = m.includes(":") ? m.slice(m.indexOf(":") + 1) : m;
    const provider = /^([^:/]+)/.exec(m)?.[1] ?? "";
    if (/claude|opus|sonnet|haiku|fable/.test(id)) return 200_000;
    if (provider === "codex" || /^gpt-(5|6)|daybreak/.test(id)) return 272_000;
    if (/^gpt-4\.1|gemini/.test(id)) return 1_000_000;
    // DeepSeek V4: older DeepSeek models on gateways are far smaller and keep the common limit below.
    if (/deepseek-v4|deepseek-flash/.test(id)) return 1_000_000;
    // Grok subscription: what xAI reported when the catalogue was listed. Until then the lowest current value
    // for its family, so compaction can only come early.
    if (provider === "xai" && /grok/.test(id)) {
        const reported = Number((ctx.state as any)?.llm?.xaiContextLengths?.[id]);
        return reported > 0 ? reported : /grok-build/.test(id) ? 256_000 : 500_000;
    }
    if (/kimi|deepseek|qwen|glm|grok/.test(id)) return 128_000;
    return null;
}
