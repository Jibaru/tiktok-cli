import type { Page, Response } from "playwright-core";
import { AppError } from "../core/errors.ts";

export const STUDIO_URL = "https://www.tiktok.com/tiktokstudio";
const USER_ENDPOINT = "/tiktokstudio/api/web/user";
const DEFAULT_TIMEOUT = 30_000;

export type StudioUser = {
  id: string;
  username: string;
  nickname: string;
  region: string;
  isPrivate: boolean;
};

export type TikTokEnvelope = {
  status_code?: number;
  statusCode?: number;
  status_msg?: string;
  statusMsg?: string;
  extra?: { logid?: string };
  log_pb?: { impr_id?: string };
};

export function endpoint(path: string, method?: "GET" | "POST") {
  return (response: Response) =>
    new URL(response.url()).pathname === path && (!method || response.request().method() === method);
}

export async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new AppError("UI_CHANGED", "TikTok returned a non-JSON response.", {
      cause: `${response.status()} ${new URL(response.url()).pathname}`,
      hint: "TikTok may have changed this page. Re-run with --headed to look.",
    });
  }
}

export function assertTikTokOk<T extends TikTokEnvelope>(body: T, action: string): T {
  const code = body.status_code ?? body.statusCode ?? 0;
  if (code === 0) return body;
  throw new AppError("API_ERROR", `TikTok rejected ${action}.`, {
    cause: body.status_msg || body.statusMsg || `status_code ${code}`,
    tiktokCode: code,
    logId: body.extra?.logid ?? body.log_pb?.impr_id,
  });
}

export async function openStudio<T>(
  page: Page,
  path: string,
  expected: (response: Response) => boolean,
  action = `loading ${path}`,
): Promise<{ user: StudioUser; body: T }> {
  const userResponse = page.waitForResponse(endpoint(USER_ENDPOINT, "GET"), { timeout: DEFAULT_TIMEOUT });
  const dataResponse = page.waitForResponse(expected, { timeout: DEFAULT_TIMEOUT });
  userResponse.catch(() => undefined);
  dataResponse.catch(() => undefined);

  await gotoOrFail(page, `${STUDIO_URL}${path}`);
  const user = await requireUser(page, userResponse);
  const body = await awaitOrClassify(page, dataResponse, action);
  return { user, body: assertTikTokOk(await readJson<T & TikTokEnvelope>(body), action) };
}

export async function gotoOrFail(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT });
  } catch (error) {
    throw new AppError("NETWORK", "Could not open TikTok.", {
      cause: error instanceof Error ? error.message.split("\n")[0] : String(error),
      hint: "Check your connection and retry.",
      retryable: true,
    });
  }
}

async function requireUser(page: Page, userResponse: Promise<Response>): Promise<StudioUser> {
  const response = await awaitOrClassify(page, userResponse, "checking the session");
  const user = toStudioUser(await readJson<RawUserResponse>(response));
  if (!user) {
    throw new AppError("AUTH_EXPIRED", "The TikTok session is no longer valid.", {
      cause: "TikTok Studio rendered the login panel.",
      hint: "tiktok auth login",
    });
  }
  return user;
}

export async function awaitOrClassify(page: Page, pending: Promise<Response>, action: string): Promise<Response> {
  try {
    return await pending;
  } catch {
    throw await classifyStuckPage(page, action);
  }
}

export async function classifyStuckPage(page: Page, action: string): Promise<AppError> {
  if (await hasCaptcha(page)) {
    return new AppError("CAPTCHA_REQUIRED", "TikTok is asking for a captcha.", {
      cause: `Blocked while ${action}.`,
      hint: "Solve it once with `tiktok auth login`, then retry.",
      retryable: true,
    });
  }
  if (await hasLoginPanel(page)) {
    return new AppError("AUTH_EXPIRED", "The TikTok session is no longer valid.", {
      cause: "TikTok Studio rendered the login panel.",
      hint: "tiktok auth login",
    });
  }
  return new AppError("UI_CHANGED", `TikTok did not respond as expected while ${action}.`, {
    cause: `Nothing matched within ${DEFAULT_TIMEOUT / 1000}s at ${page.url()}.`,
    hint: "TikTok may have changed this page. Check the debug bundle screenshot.",
    retryable: true,
  });
}

async function hasCaptcha(page: Page): Promise<boolean> {
  return (await page.locator('[id*="captcha" i], [class*="captcha_verify" i], [class*="captcha-verify" i]').count()) > 0;
}

async function hasLoginPanel(page: Page): Promise<boolean> {
  return (await page.getByText(/Inicia sesión en TikTok|Log in to TikTok/i).count()) > 0;
}

type RawUserResponse = {
  userId?: string;
  userExtra?: { isPrivate?: boolean };
  userBaseInfo?: {
    UserProfile?: { UserBase?: { UniqId?: string; NickName?: string; Region?: { Region?: string } } };
  };
};

export function toStudioUser(raw: RawUserResponse): StudioUser | undefined {
  const base = raw.userBaseInfo?.UserProfile?.UserBase;
  if (!raw.userId || !base) return undefined;
  return {
    id: raw.userId,
    username: base.UniqId ?? "",
    nickname: base.NickName ?? "",
    region: base.Region?.Region ?? "",
    isPrivate: raw.userExtra?.isPrivate ?? false,
  };
}

export async function readCurrentUser(page: Page): Promise<StudioUser | undefined> {
  const userResponse = page.waitForResponse(endpoint(USER_ENDPOINT, "GET"), { timeout: DEFAULT_TIMEOUT });
  userResponse.catch(() => undefined);
  await gotoOrFail(page, STUDIO_URL);
  const response = await userResponse.catch(() => undefined);
  if (!response) return undefined;
  return toStudioUser(await response.json().catch(() => ({})));
}

export async function waitForLogin(page: Page, timeoutMs: number): Promise<StudioUser> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !page.isClosed()) {
    const cookies = await page.context().cookies("https://www.tiktok.com");
    if (cookies.some((cookie) => cookie.name === "sessionid" && cookie.value)) {
      const user = await readCurrentUser(page);
      if (user) return user;
    }
    await page.waitForTimeout(2_000).catch(() => undefined);
  }
  throw new AppError("AUTH_REQUIRED", "Login was not completed.", {
    cause: page.isClosed() ? "The browser window was closed." : `Timed out after ${timeoutMs / 1000}s.`,
    hint: "tiktok auth login",
    retryable: true,
  });
}
