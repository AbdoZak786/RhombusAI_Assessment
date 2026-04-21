export function extractDatasetId(json: unknown): string | undefined {
  if (typeof json !== "object" || json === null) {
    return undefined;
  }
  const root = json as Record<string, unknown>;
  const direct =
    (typeof root.dataset_id === "string" && root.dataset_id) ||
    (typeof root.datasetId === "string" && root.datasetId);
  if (direct) {
    return direct;
  }
  const data = root.data;
  if (typeof data === "object" && data !== null) {
    const nested = data as Record<string, unknown>;
    if (typeof nested.dataset_id === "string") {
      return nested.dataset_id;
    }
    if (typeof nested.datasetId === "string") {
      return nested.datasetId;
    }
  }
  return undefined;
}

export function extractErrorMessage(json: unknown): string {
  if (typeof json !== "object" || json === null) {
    return "";
  }
  const o = json as Record<string, unknown>;
  const candidates = [o.message, o.error, o.detail];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) {
      return c;
    }
  }
  const errors = o.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return JSON.stringify(errors);
  }
  return JSON.stringify(json);
}
