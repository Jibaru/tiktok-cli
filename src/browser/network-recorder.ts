import type { Page, Response } from "playwright-core";

export type RecordedResponse = {
  at: string;
  method: string;
  url: string;
  status: number;
  body?: string;
};

const MAX_ENTRIES = 60;
const MAX_BODY = 8_000;
const API_PATH = /\/(api|aweme|tiktok|tiktokstudio)\//;

export class NetworkRecorder {
  private readonly entries: RecordedResponse[] = [];

  attach(page: Page): void {
    page.on("response", (response) => void this.record(response));
  }

  snapshot(): RecordedResponse[] {
    return [...this.entries];
  }

  private async record(response: Response): Promise<void> {
    const url = response.url();
    if (!url.includes("tiktok.com") || !API_PATH.test(new URL(url).pathname)) return;
    const entry: RecordedResponse = {
      at: new Date().toISOString(),
      method: response.request().method(),
      url: stripSignatures(url),
      status: response.status(),
    };
    try {
      entry.body = redactTokens(await response.text()).slice(0, MAX_BODY);
    } catch {
      entry.body = undefined;
    }
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
  }
}

function stripSignatures(url: string): string {
  const parsed = new URL(url);
  for (const key of ["msToken", "X-Bogus", "X-Gnarly", "verifyFp", "device_id", "odinId"]) parsed.searchParams.delete(key);
  return parsed.toString();
}

function redactTokens(body: string): string {
  return body.replace(/"(tt-csrf-token|msToken|sessionid|sid_tt)"\s*:\s*"[^"]*"/g, '"$1":"<redacted>"');
}
