const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
};

/**
 * Generates or edits marketing images with Nano Banana 2.1 through the Gemini API or Vertex AI.
 * A Google AI Studio key in `secret://nanobanana/apiKey` selects the Gemini API (a personal account, no
 * Cloud project); otherwise the request goes to Vertex AI with the service-account key.
 * Use reference images for product, character, layout, or iterative edits; the
 * generated binary data is written to disk rather than returned through chat.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
  /** Detailed generation or editing instruction, including exact copy and constraints. */
  prompt: string;
  /** Output file path; multiple images get -2, -3 suffixes. @default "artifacts/nano-banana.png" */
  out?: string;
  /** Local reference images to include before the prompt. @maximum 14 */
  images?: string[];
  /** Output aspect ratio. @default "1:1" */
  aspectRatio?: "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9";
  /** Output resolution and principal cost driver. @default "1K" */
  resolution?: "1K" | "2K" | "4K";
  /** Number of candidate images requested. @default 1 @minimum 1 @maximum 4 */
  count?: number;
  /** Google Cloud project override; Vertex AI only. */
  project?: string;
  /** Vertex location; Vertex AI only. @default "global" */
  location?: string;
  /** Model ID. @default "gemini-nano-banana-2.1" */
  model?: string;
  /** Which API to call; by default Vertex AI when project or location is given, else the Gemini API when an AI Studio key is stored, else Vertex AI. */
  backend?: "gemini" | "vertex";
}): Promise<types.nanobanana.Generation> {
  if (!opts.prompt.trim()) throw new Error("prompt is required");
  if ((opts.images?.length ?? 0) > 14) throw new Error("at most 14 reference images are supported");
  const count = opts.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error("count must be an integer from 1 to 4");

  // A project or location names a Vertex target, and the bill goes with it: never drop them for a stored key.
  const vertexTarget = opts.project !== undefined || opts.location !== undefined;
  if (opts.backend === "gemini" && vertexTarget) throw new Error("nanobanana: project and location apply to Vertex AI only");
  const wantsGemini = opts.backend === "gemini" || (!opts.backend && !vertexTarget);
  const apiKey = wantsGemini ? await ctx.fns.secrets.getLocal({ namespace: "nanobanana", name: "apiKey" }) : null;
  if (opts.backend === "gemini" && !apiKey) throw new Error("nanobanana: Gemini API key is not configured (secret://nanobanana/apiKey)");
  const backend = apiKey ? "gemini" : "vertex";
  const project = backend === "vertex" ? await ctx.fns.nanobanana.project({ project: opts.project }) : null;
  const location = opts.location ?? "global";
  const model = opts.model ?? "gemini-nano-banana-2.1";
  const resolution = opts.resolution ?? "1K";
  const aspectRatio = opts.aspectRatio ?? "1:1";
  const parts: Array<Record<string, unknown>> = [];

  for (const image of opts.images ?? []) {
    const absolute = ctx.fns.workspace.resolve({ path: image });
    const file = Bun.file(absolute);
    if (!(await file.exists())) throw new Error(`reference image not found: ${image}`);
    const ext = absolute.split(".").at(-1)?.toLowerCase() ?? "";
    const mimeType = MIME[ext];
    if (!mimeType) throw new Error(`unsupported reference format: ${image}; use PNG, JPEG, or WebP`);
    parts.push({ inlineData: { mimeType, data: Buffer.from(await file.arrayBuffer()).toString("base64") } });
  }
  parts.push({ text: opts.prompt });

  let url: string;
  let auth: Record<string, string>;
  if (backend === "gemini") {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    auth = { "x-goog-api-key": String(apiKey) };
  } else {
    const token = await ctx.fns.nanobanana.accessToken({});
    const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
    url = `https://${host}/v1/projects/${encodeURIComponent(project!)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
    auth = { authorization: `Bearer ${token}` };
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        candidateCount: count,
        imageConfig: { aspectRatio, imageSize: resolution },
      },
    }),
  });
  const json = await response.json() as any;
  const api = backend === "gemini" ? "Gemini API" : "Vertex AI";
  if (!response.ok) throw new Error(`${api} ${response.status}: ${json?.error?.message ?? JSON.stringify(json)}`);

  const requested = ctx.fns.workspace.resolve({ path: opts.out ?? "artifacts/nano-banana.png" });
  const dot = requested.lastIndexOf(".");
  const base = dot > requested.lastIndexOf("/") ? requested.slice(0, dot) : requested;
  const fallbackExt = dot > requested.lastIndexOf("/") ? requested.slice(dot) : ".png";
  await ctx.fns.files.mkdir({ path: requested.slice(0, requested.lastIndexOf("/")) });
  const files: string[] = [];
  const text: string[] = [];
  let imageNo = 0;
  const seen = new Set<string>();
  for (const candidate of json.candidates ?? []) for (const part of candidate.content?.parts ?? []) {
    if (typeof part.text === "string" && part.text.trim()) text.push(part.text.trim());
    const data = part.inlineData?.data;
    if (!data) continue;
    const digest = String(Bun.hash(data));
    if (seen.has(digest)) continue;
    seen.add(digest);
    imageNo++;
    const ext = part.inlineData?.mimeType === "image/jpeg" ? ".jpg" : part.inlineData?.mimeType === "image/webp" ? ".webp" : fallbackExt;
    const path = `${base}${imageNo === 1 ? "" : `-${imageNo}`}${ext}`;
    await Bun.write(path, Buffer.from(data, "base64"));
    files.push(path);
  }
  if (!files.length) throw new Error(`${api} returned no image${text.length ? `: ${text.join(" ")}` : ""}`);
  return { files, model, backend, project, resolution, aspectRatio, text, usage: json.usageMetadata };
}
