import type { Page } from "playwright-core";
import { AppError } from "../core/errors.ts";
import { monthIndex, PRIVACY_LABEL, type Privacy, type Schedule } from "../tiktok/post.ts";

const UPLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const EDITOR = '.public-DraftEditor-content[contenteditable="true"]';

export async function attachVideo(page: Page, file: string, onProgress: (message: string) => void): Promise<void> {
  await page.locator('input[type="file"]').first().setInputFiles(file);
  const deadline = Date.now() + UPLOAD_TIMEOUT_MS;
  let lastPercent = "";
  while (Date.now() < deadline) {
    await dismissKnownModals(page);
    if (await page.locator(EDITOR).count()) {
      const status = await page.getByText(/Cargado|Uploaded/).count();
      if (status > 0) return;
    }
    const percent = (await page.getByText(/^\d{1,3}%$/).first().textContent({ timeout: 500 }).catch(() => null)) ?? "";
    if (percent && percent !== lastPercent) {
      onProgress(`Uploading… ${percent}`);
      lastPercent = percent;
    }
    await page.waitForTimeout(1_000);
  }
  throw new AppError("UI_CHANGED", "The upload did not finish in time.", {
    cause: `No "Cargado" status after ${UPLOAD_TIMEOUT_MS / 60_000} minutes.`,
    retryable: true,
  });
}

export async function dismissKnownModals(page: Page): Promise<void> {
  const contentCheck = page.getByRole("dialog").filter({ hasText: "revisiones automáticas" });
  if (await contentCheck.count()) await contentCheck.getByRole("button", { name: "Cancelar" }).click();
  const tip = page.getByRole("button", { name: "Entendido" });
  if (await tip.count()) await tip.first().click().catch(() => undefined);
}

export async function fillDescription(page: Page, description: string): Promise<void> {
  const editor = page.locator(EDITOR);
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  if (description) {
    await editor.evaluate((element, text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, description);
  }
  await page.waitForTimeout(300);
  const actual = (await editor.innerText()).replace(/\n$/, "");
  if (normalize(actual) !== normalize(description)) {
    throw new AppError("UI_CHANGED", "The description editor did not accept the text.", {
      cause: `Expected ${JSON.stringify(description.slice(0, 60))}, editor shows ${JSON.stringify(actual.slice(0, 60))}.`,
    });
  }
}

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

export async function choosePrivacy(page: Page, privacy: Privacy): Promise<void> {
  const combo = page.getByRole("combobox").filter({ hasText: /^(Todos|Seguidores|Amigos|Solo tú)/ }).first();
  await combo.scrollIntoViewIfNeeded();
  await combo.click();
  const option = page.getByRole("option", { name: PRIVACY_LABEL[privacy] });
  if (!(await option.count())) {
    await page.keyboard.press("Escape");
    throw new AppError("VALIDATION", `Privacy "${privacy}" is not available on this account.`, {
      cause: "Private accounts cannot post to everyone.",
      hint: "Use --privacy followers, friends or only-me.",
    });
  }
  await option.first().click();
  if (!PRIVACY_LABEL[privacy].test((await combo.innerText()).trim())) {
    throw new AppError("UI_CHANGED", "The privacy selector did not change.", { cause: `Shows "${await combo.innerText()}".` });
  }
}

export async function chooseSchedule(page: Page, schedule: Schedule, waitForHuman: boolean, onWait: () => void): Promise<void> {
  await page.getByText("Programación", { exact: true }).first().click();
  const consent = page.getByRole("dialog").filter({ hasText: "publicación programada" });
  if (await consent.isVisible({ timeout: 1_500 }).catch(() => false)) {
    if (!waitForHuman) {
      throw new AppError("CONSENT_REQUIRED", "TikTok asks you to allow scheduled posts first.", {
        cause: 'Studio shows "¿Permitir que el vídeo se guarde para una publicación programada?".',
        hint: "Run the same command with --headed from your terminal and click Permitir yourself.",
      });
    }
    onWait();
    await consent.waitFor({ state: "hidden", timeout: 5 * 60_000 });
  }
  const [timeInput, dateInput] = await scheduleInputs(page);
  await pickDate(page, dateInput, schedule.date);
  await pickTime(page, timeInput, schedule.time);
  const shown = { time: await page.locator(timeInput).inputValue(), date: await page.locator(dateInput).inputValue() };
  if (shown.time !== schedule.time || shown.date !== schedule.date) {
    throw new AppError("UI_CHANGED", "The schedule pickers did not take the requested date and time.", {
      cause: `Wanted ${schedule.date} ${schedule.time}, Studio shows ${shown.date} ${shown.time}.`,
    });
  }
}

async function scheduleInputs(page: Page): Promise<[string, string]> {
  const marked = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll<HTMLInputElement>("input[readonly]")];
    const time = inputs.find((input) => /^\d{2}:\d{2}$/.test(input.value));
    const date = inputs.find((input) => /^\d{4}-\d{2}-\d{2}$/.test(input.value));
    time?.setAttribute("data-tt-time", "");
    date?.setAttribute("data-tt-date", "");
    return Boolean(time && date);
  });
  if (!marked) throw new AppError("UI_CHANGED", "Could not find the schedule date and time fields.");
  return ["[data-tt-time]", "[data-tt-date]"];
}

// The picker commits whatever is centered when it closes, so each click waits for the field to settle.
async function pickTime(page: Page, input: string, time: string): Promise<void> {
  const [hour, minute] = time.split(":") as [string, string];
  await page.locator(input).click();
  const columns = page.locator(".tiktok-timepicker-option-list");
  if ((await columns.count()) < 2) throw new AppError("UI_CHANGED", "Could not find the hour and minute columns of the time picker.");
  await columns.nth(0).locator(".tiktok-timepicker-option-item", { hasText: new RegExp("^" + hour + "$") }).click();
  await waitForValue(page, input, (value) => value.startsWith(hour + ":"));
  await columns.nth(1).locator(".tiktok-timepicker-option-item", { hasText: new RegExp("^" + minute + "$") }).click();
  await waitForValue(page, input, (value) => value === time);
  await page.waitForTimeout(500);
}

async function waitForValue(page: Page, input: string, accept: (value: string) => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (accept(await page.locator(input).inputValue())) return;
    await page.waitForTimeout(150);
  }
}

type CalendarState = { header: string; found: boolean };

async function markCalendar(page: Page, day: number): Promise<CalendarState> {
  return page.evaluate((day) => {
    for (const marker of ["data-tt-prev", "data-tt-next", "data-tt-day"]) {
      document.querySelectorAll(`[${marker}]`).forEach((element) => element.removeAttribute(marker));
    }
    const calendar = [...document.querySelectorAll<HTMLElement>('[class*="calendar-wrapper"]')].find((element) => element.offsetParent !== null);
    const title = calendar?.querySelector<HTMLElement>('[class*="month-header-wrapper"] [class*="title-wrapper"]');
    if (!calendar || !title) return { header: "", found: false };
    const arrows = calendar.querySelectorAll('[class*="month-header-wrapper"] [class*="arrow"]');
    arrows[0]?.setAttribute("data-tt-prev", "");
    arrows[arrows.length - 1]?.setAttribute("data-tt-next", "");
    const cells = [...calendar.querySelectorAll<HTMLElement>('[class*="days-wrapper"] *')].filter(
      (element) => element.children.length === 0 && element.innerText?.trim() === String(day),
    );
    const cell = day <= 15 ? cells[0] : cells.at(-1);
    cell?.setAttribute("data-tt-day", "");
    return { header: title.innerText.trim().replace(/\s+/g, " "), found: Boolean(cell) };
  }, day);
}

async function pickDate(page: Page, input: string, date: string): Promise<void> {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const wanted = year * 12 + (month - 1);
  await page.locator(input).click();
  for (let attempt = 0; attempt < 24; attempt++) {
    const state = await markCalendar(page, day);
    if (!state.header) throw new AppError("UI_CHANGED", "Could not find the month header of the date picker.");
    const [label, shownYear] = state.header.split(/\s*\/\s*/);
    const shown = Number(shownYear) * 12 + monthIndex(label ?? "");
    if (shown === wanted) {
      if (!state.found) throw new AppError("VALIDATION", `${date} cannot be selected in TikTok's calendar.`);
      await page.locator("[data-tt-day]").click();
      return;
    }
    await page.locator(wanted > shown ? "[data-tt-next]" : "[data-tt-prev]").click();
  }
  throw new AppError("UI_CHANGED", `Could not navigate the calendar to ${date}.`);
}
