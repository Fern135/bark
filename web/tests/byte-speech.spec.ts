import { expect, test, type Page } from "@playwright/test";

const idea = "Build a treasure hunt using your Gem and Flag.";
// Valid, silent audio exercises the real browser decoder/playback without paid calls.
function silentWav() {
  const samples = 8_000 * 20;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8_000, 24); wav.writeUInt32LE(16_000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  return wav;
}

async function setup(page: Page, signedIn = true) {
  await page.addInitScript(() => {
    const observed = window as typeof window & { voiceStarts: number; voiceStops: number; barkStarts: number };
    observed.voiceStarts = 0; observed.voiceStops = 0; observed.barkStarts = 0;
    const start = AudioBufferSourceNode.prototype.start;
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function (...args) { observed.voiceStarts++; return start.apply(this, args); };
    AudioBufferSourceNode.prototype.stop = function (...args) { observed.voiceStops++; return stop.apply(this, args); };
    const bark = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) { observed.barkStarts++; return bark.apply(this, args); };
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me/") return route.fulfill(signedIn
      ? { json: { user: { user_id: "byte-voice-test", username: "Voice tester", email: "voice@example.test" } } }
      : { status: 401, json: { error: "Sign in" } });
    if (path === "/api/auth/csrf/") return route.fulfill({ json: {} });
    if (path === "/api/coach/review/") {
      const body = route.request().postDataJSON();
      return route.fulfill({ json: { revision: body.revision, suggestion: { category: "idea", message: idea, issueKey: "gem-flag", line: null, blockId: null } } });
    }
    return route.abort();
  });
}

async function openEditor(page: Page) {
  await page.goto("/editor");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  return page.locator("[data-byte-assistant]");
}

test("Byte speaks the visible AI tip, replays from memory, and remembers mute", async ({ page }, testInfo) => {
  await setup(page);
  const messages: string[] = [];
  await page.route("**/api/coach/speech/", async (route) => {
    expect(route.request().method()).toBe("POST");
    const body = route.request().postDataJSON();
    expect(Object.keys(body)).toEqual(["text"]);
    expect(route.request().headers()["xi-api-key"]).toBeUndefined();
    messages.push(body.text);
    await route.fulfill({ contentType: "audio/wav", body: silentWav() });
  });
  const byte = await openEditor(page);
  expect(messages).toEqual([]);
  await byte.getByRole("button", { name: /Byte assistant/ }).click();
  await expect(byte.locator("p")).toHaveText(idea);
  await expect(byte).toHaveAttribute("data-speech", "speaking");
  expect(messages).toEqual([idea]);
  expect(await page.evaluate(() => (window as typeof window & { barkStarts: number }).barkStarts)).toBe(0);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { voiceStarts: number }).voiceStarts)).toBe(1);
  await byte.getByRole("button", { name: "Hear tip" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { voiceStarts: number }).voiceStarts)).toBe(2);
  expect(messages).toEqual([idea]);
  await byte.getByRole("button", { name: "Byte audio", exact: true }).click();
  await expect(byte.getByRole("button", { name: "Byte audio", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { voiceStops: number }).voiceStops)).toBe(2);
  await page.screenshot({ path: testInfo.outputPath("byte-sound-toggle.png") });

  await page.reload();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  await byte.getByRole("button", { name: /Byte assistant/ }).click();
  await expect(byte.locator("p")).toHaveText(idea);
  await expect(byte.getByRole("button", { name: "Byte audio", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(650); // Beyond the voice debounce; mute must suppress the request.
  expect(messages).toEqual([idea]);
  expect(await page.evaluate(() => (window as typeof window & { barkStarts: number }).barkStarts)).toBe(0);
  await byte.getByRole("button", { name: "Byte audio", exact: true }).click();
  await expect(byte).toHaveAttribute("data-speech", "speaking");
  expect(messages).toEqual([idea, idea]);
  await byte.getByRole("button", { name: "Dismiss Byte’s tip" }).click();
  await expect(byte).toHaveAttribute("data-speech", "idle");
  expect(await page.evaluate(() => (window as typeof window & { voiceStops: number }).voiceStops)).toBe(1);
});

test("closing a bubble cancels delayed speech and a stale response never plays", async ({ page }) => {
  await setup(page);
  let requested = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/coach/speech/", async (route) => {
    requested = true;
    await gate;
    await route.fulfill({ contentType: "audio/wav", body: silentWav() }).catch(() => {});
  });
  const byte = await openEditor(page);
  await byte.getByRole("button", { name: /Byte assistant/ }).click();
  await expect.poll(() => requested).toBe(true);
  await byte.getByRole("button", { name: "Dismiss Byte’s tip" }).click();
  release();
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => (window as typeof window & { voiceStarts: number }).voiceStarts)).toBe(0);
  await expect(byte).toHaveAttribute("data-speech", "idle");
});

test("changing the visible tip interrupts old audio and leaving the editor tab stops it", async ({ page }) => {
  await setup(page);
  const messages: string[] = [];
  await page.route("**/api/coach/speech/", async (route) => {
    messages.push(route.request().postDataJSON().text);
    await route.fulfill({ contentType: "audio/wav", body: silentWav() });
  });
  const byte = await openEditor(page);
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.getByRole("button", { name: /Language: Blocks/ }).click();
  await page.getByRole("button", { name: "Convert to Python" }).click();
  await byte.getByRole("button", { name: /Byte assistant/ }).click();
  await expect(byte).toHaveAttribute("data-speech", "speaking");
  await byte.getByRole("button", { name: "Turn off AI tips" }).click();
  await page.locator(".cm-content").fill('if True\n    print("Hello")');
  await expect(byte.locator("p")).toContainText("colon");
  await expect(byte).toHaveAttribute("data-speech", "speaking");
  await expect.poll(() => messages.at(-1)).toContain("colon");
  const before = await page.evaluate(() => (window as typeof window & { voiceStops: number }).voiceStops);
  await page.getByRole("button", { name: "Viewport", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { voiceStops: number }).voiceStops)).toBe(before + 1);
});

test("an unavailable provider keeps the text tip and respects its retry delay", async ({ page }) => {
  await setup(page);
  let requests = 0;
  await page.route("**/api/coach/speech/", (route) => {
    requests++;
    return route.fulfill({ status: 503, headers: { "Retry-After": "120" }, json: { error: "Byte’s voice is temporarily unavailable." } });
  });
  const byte = await openEditor(page);
  await byte.getByRole("button", { name: /Byte assistant/ }).click();
  await expect(byte.getByRole("status")).toContainText("Voice is unavailable");
  await expect(byte.locator("p")).toHaveText(idea);
  await byte.getByRole("button", { name: "Hear tip" }).click();
  await page.waitForTimeout(650);
  expect(requests).toBe(1);
  expect(await page.evaluate(() => (window as typeof window & { voiceStarts: number }).voiceStarts)).toBe(0);
  expect(await page.evaluate(() => (window as typeof window & { barkStarts: number }).barkStarts)).toBe(0);
});

test("guest tips stay readable without sending a speech request", async ({ page }) => {
  await setup(page, false);
  let requests = 0;
  await page.route("**/api/coach/speech/", (route) => { requests++; return route.abort(); });
  const byte = await openEditor(page);
  await byte.getByRole("button", { name: /Byte assistant/ }).click();
  await expect(byte.getByRole("status")).toContainText("Sign in to hear Byte’s tips.");
  await expect(byte.locator("p")).not.toBeEmpty();
  await page.waitForTimeout(650);
  expect(requests).toBe(0);
});
