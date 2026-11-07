export type Generation = {
  /** Files written for generated images. */
  files: string[];
  /** Model used. */
  model: string;
  /** API that served the request. */
  backend: "gemini" | "vertex";
  /** Google Cloud project billed for a Vertex AI request; null on the Gemini API, which bills the key's account. */
  project: string | null;
  /** Requested output resolution. */
  resolution: "1K" | "2K" | "4K";
  /** Requested aspect ratio. */
  aspectRatio: string;
  /** Text parts returned alongside images, if any. */
  text: string[];
  /** Usage metadata returned by the API. */
  usage?: Record<string, number>;
};
