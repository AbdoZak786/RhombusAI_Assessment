import fs from "fs";
import path from "path";
import { test, expect } from "@playwright/test";
import {
  extractDatasetId,
  extractErrorMessage,
} from "../helpers/dataset-response";

function authHeaders(): Record<string, string> {
  const raw = (process.env.RHOMBUS_API_TOKEN ?? process.env.API_BEARER_TOKEN ?? "").trim();
  if (!raw) {
    return {};
  }
  // Tolerate users pasting tokens with or without a leading "Bearer " prefix.
  const token = raw.replace(/^Bearer\s+/i, "");
  return { Authorization: `Bearer ${token}` };
}

function resolveUploadUrl(): string | undefined {
  return (
    process.env.API_DATASET_UPLOAD_URL ??
    process.env.RHOMBUS_DATASET_UPLOAD_URL
  );
}

test.describe("Dataset upload API", () => {
  test("accepts a CSV upload and returns dataset_id", async ({ request }) => {
    const uploadUrl = resolveUploadUrl();
    test.skip(
      !uploadUrl,
      "Set API_DATASET_UPLOAD_URL (or RHOMBUS_DATASET_UPLOAD_URL) to the multipart dataset upload endpoint.",
    );

    // The positive path needs a CSV the server can tokenize (consistent column
    // counts). The UI flow uses a messier fixture; here we use a parseable
    // variant that still contains nulls so the pipeline has something to clean.
    const csvPath = path.join(__dirname, "..", "fixtures", "valid-messy.csv");
    const buffer = fs.readFileSync(csvPath);

    const title = `e2e-upload-${Date.now()}`;
    const response = await request.post(uploadUrl!, {
      headers: {
        ...authHeaders(),
      },
      multipart: {
        // Rhombus dataset API requires a `title` field alongside `file`.
        title,
        file: {
          name: "valid-messy.csv",
          mimeType: "text/csv",
          buffer,
        },
      },
    });

    expect(
      [200, 201],
      `Unexpected status ${response.status()}: ${await response.text()}`,
    ).toContain(response.status());

    const json = await response.json().catch(async () => {
      throw new Error(`Non-JSON success body: ${await response.text()}`);
    });

    // The endpoint uses `id` for the persisted dataset id; accept common
    // aliases (`dataset_id`, `datasetId`, nested `data.dataset_id`) as well.
    const datasetId =
      extractDatasetId(json) ??
      (typeof (json as Record<string, unknown>).id !== "undefined"
        ? String((json as Record<string, unknown>).id)
        : undefined);
    expect(datasetId, JSON.stringify(json)).toBeTruthy();
    expect(datasetId!.length).toBeGreaterThan(0);
  });

  test("rejects a .txt upload to the dataset endpoint with 400/422", async ({
    request,
  }) => {
    const uploadUrl = resolveUploadUrl();
    test.skip(
      !uploadUrl,
      "Set API_DATASET_UPLOAD_URL (or RHOMBUS_DATASET_UPLOAD_URL) to the multipart dataset upload endpoint.",
    );

    // Contract: dataset endpoint is a CSV ingest surface — a plain-text upload
    // must be refused with a validation error (400 or 422) and a message that
    // clearly signals the file type / format problem.
    const response = await request.post(uploadUrl!, {
      headers: { ...authHeaders() },
      multipart: {
        title: `e2e-negative-${Date.now()}`,
        file: {
          name: "not-a-dataset.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("this is a plain text file, not a CSV dataset\n"),
        },
      },
    });

    expect(
      [400, 422],
      `Unexpected status ${response.status()}: ${await response.text()}`,
    ).toContain(response.status());

    const bodyText = await response.text();
    expect(bodyText.length).toBeGreaterThan(0);

    let message = bodyText;
    try {
      message = extractErrorMessage(JSON.parse(bodyText));
    } catch {
      // keep raw text
    }

    expect(message.toLowerCase()).toMatch(
      /csv|file|type|format|invalid|unsupported|extension|mime/,
    );
  });
});
