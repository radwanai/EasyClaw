// browser.js — Headless browser automation for Harvey via Playwright
// Harvey can navigate websites, fill forms, click buttons, read content, take screenshots
// Includes human-like delays to avoid bot detection

const fs = require("fs");
const path = require("path");

let chromium, browser, currentPage, currentContext;
const COOKIES_FILE = path.join(process.env.DATA_DIR || "./data", "browser_cookies.json");

// Lazy-load playwright (heavy dependency)
function loadPlaywright() {
  if (chromium) return;
  chromium = require("playwright").chromium;
}

// ─── Human-like Timing ──────────────────────────────────

function randomDelay(min = 300, max = 800) {
  return Math.floor(Math.random() * (max - min) + min);
}

async function humanPause(page, min = 500, max = 1500) {
  await page.waitForTimeout(randomDelay(min, max));
}

// Type like a human — one character at a time with random delays
async function humanType(page, text) {
  for (const char of text) {
    await page.keyboard.type(char, { delay: randomDelay(30, 120) });
  }
}

// Move mouse to random spot before clicking (looks more human)
async function humanMouseMove(page, x, y) {
  // Move to a random nearby spot first, then to the target
  const jitterX = x + (Math.random() * 20 - 10);
  const jitterY = y + (Math.random() * 20 - 10);
  await page.mouse.move(jitterX, jitterY, { steps: randomDelay(3, 8) });
  await page.waitForTimeout(randomDelay(100, 300));
  await page.mouse.move(x, y, { steps: randomDelay(2, 5) });
}

// ─── Browser Lifecycle ──────────────────────────────────

// Load saved cookies from disk
function loadCookies() {
  try {
    if (fs.existsSync(COOKIES_FILE)) {
      return JSON.parse(fs.readFileSync(COOKIES_FILE, "utf-8"));
    }
  } catch {}
  return [];
}

// Save cookies to disk for persistence across sessions
async function saveCookies() {
  try {
    if (currentContext) {
      const cookies = await currentContext.cookies();
      fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
    }
  } catch {}
}

async function ensureBrowser() {
  loadPlaywright();
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
      ],
    });
    currentPage = null;
    currentContext = null;
  }
  if (!currentPage || currentPage.isClosed()) {
    currentContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "en-US",
      timezoneId: "America/Los_Angeles",
      geolocation: { latitude: 33.9742, longitude: -118.4264 }, // Playa Vista
      permissions: ["geolocation"],
    });

    // Restore saved cookies (stays logged in to Amazon, etc.)
    const savedCookies = loadCookies();
    if (savedCookies.length > 0) {
      try {
        await currentContext.addCookies(savedCookies);
      } catch {}
    }

    currentPage = await currentContext.newPage();

    // Stealth: remove webdriver flag and automation indicators
    await currentPage.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      // Override plugins to look real
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
      // Override languages
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });
      // Fake chrome runtime
      window.chrome = { runtime: {} };
      // Prevent detection via permissions API
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) =>
        parameters.name === "notifications"
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);
    });
  }
  return currentPage;
}

async function closeBrowser() {
  try {
    // Save cookies before closing so sessions persist
    await saveCookies();
    if (browser) await browser.close();
    browser = null;
    currentPage = null;
    currentContext = null;
    return { closed: true };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── Navigation ─────────────────────────────────────────

async function navigate(url) {
  const page = await ensureBrowser();
  try {
    // Add https if no protocol
    if (!url.startsWith("http")) url = "https://" + url;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Wait like a human would — pages take time to render
    await humanPause(page, 2000, 4000);
    // Wait for network to settle
    try {
      await page.waitForLoadState("networkidle", { timeout: 8000 });
    } catch {} // Don't fail if network doesn't settle
    // Extra pause to look natural
    await humanPause(page, 500, 1500);
    // Save cookies after every navigation (captures login state)
    await saveCookies();
    return {
      url: page.url(),
      title: await page.title(),
      status: "loaded",
    };
  } catch (err) {
    return { error: `navigation failed: ${err.message}`, url };
  }
}

// ─── Read Page Content ──────────────────────────────────

async function readPage() {
  const page = await ensureBrowser();
  try {
    const url = page.url();
    const title = await page.title();

    // Small pause before reading — humans don't instantly scrape
    await humanPause(page, 300, 800);

    // Get visible text content (not hidden elements)
    const text = await page.evaluate(() => {
      // Get main content areas first, fallback to body
      const selectors = ["main", "article", "[role='main']", "#content", ".content", "body"];
      let el = null;
      for (const sel of selectors) {
        el = document.querySelector(sel);
        if (el) break;
      }
      if (!el) el = document.body;

      // Get text, clean it up
      return el.innerText.replace(/\n{3,}/g, "\n\n").trim();
    });

    // Truncate to prevent token explosion
    const truncated = text.length > 4000 ? text.slice(0, 4000) + "\n...(truncated)" : text;

    return { url, title, text: truncated, length: text.length };
  } catch (err) {
    return { error: `read failed: ${err.message}` };
  }
}

// ─── Find Interactive Elements ──────────────────────────

async function getFormElements() {
  const page = await ensureBrowser();
  try {
    await humanPause(page, 200, 500);
    const elements = await page.evaluate(() => {
      const results = [];
      // Input fields
      document.querySelectorAll("input, textarea, select").forEach((el, i) => {
        if (el.type === "hidden") return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        results.push({
          index: results.length,
          tag: el.tagName.toLowerCase(),
          type: el.type || "text",
          name: el.name || el.id || "",
          placeholder: el.placeholder || "",
          ariaLabel: el.getAttribute("aria-label") || "",
          label: (() => {
            // Try to find associated label
            if (el.id) {
              const label = document.querySelector(`label[for="${el.id}"]`);
              if (label) return label.innerText.trim();
            }
            // Check parent for label text
            const parent = el.closest("label, .form-group, .field");
            if (parent) {
              const labelEl = parent.querySelector("label, .label");
              if (labelEl) return labelEl.innerText.trim();
            }
            return "";
          })(),
          value: el.value || "",
          options: el.tagName === "SELECT" ? [...el.options].map(o => ({ value: o.value, text: o.text })) : undefined,
        });
      });
      // Buttons and clickable links
      document.querySelectorAll("button, input[type='submit'], a[role='button'], [type='button'], a[href]").forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        if (el.tagName === "A" && !el.getAttribute("role") && el.innerText.trim().length < 2) return;
        if (el.tagName === "A" && !el.getAttribute("role") && !el.href) return;
        results.push({
          index: results.length,
          tag: el.tagName === "A" ? "link" : "button",
          type: el.type || (el.tagName === "A" ? "link" : "button"),
          text: el.innerText.trim().slice(0, 80) || el.value || el.title || el.getAttribute("aria-label") || "",
          name: el.name || el.id || "",
          href: el.tagName === "A" ? el.href : undefined,
        });
      });
      return results;
    });

    return {
      url: page.url(),
      elements,
      count: elements.length,
      hint: "Use fill_field with the element index and value, or click_element with the index",
    };
  } catch (err) {
    return { error: `form scan failed: ${err.message}` };
  }
}

// ─── Fill a Form Field (React-compatible, human-like) ───

async function fillField(index, value) {
  const page = await ensureBrowser();
  try {
    // First, find the element and get its selector
    const elementInfo = await page.evaluate((index) => {
      const inputs = [];
      document.querySelectorAll("input, textarea, select").forEach((el) => {
        if (el.type === "hidden") return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        inputs.push(el);
      });
      // Also include buttons and links for the index count
      document.querySelectorAll("button, input[type='submit'], a[role='button'], [type='button'], a[href]").forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        if (el.tagName === "A" && !el.getAttribute("role") && el.innerText.trim().length < 2) return;
        if (el.tagName === "A" && !el.getAttribute("role") && !el.href) return;
        inputs.push(el);
      });

      if (index < 0 || index >= inputs.length) return { error: `Index ${index} out of range (0-${inputs.length - 1})` };

      const el = inputs[index];
      if (el.tagName === "BUTTON" || el.type === "submit" || el.type === "button" || el.tagName === "A") {
        return { error: "Can't fill a button/link — use click_element instead" };
      }

      // Return element info for Playwright to target
      const tag = el.tagName.toLowerCase();
      const isSelect = tag === "select";
      let selector = null;
      if (el.id) selector = `#${el.id}`;
      else if (el.name) selector = `${tag}[name="${el.name}"]`;
      else if (el.placeholder) selector = `${tag}[placeholder="${el.placeholder}"]`;
      else if (el.getAttribute("aria-label")) selector = `${tag}[aria-label="${el.getAttribute("aria-label")}"]`;

      const rect = el.getBoundingClientRect();
      return {
        tag, type: el.type, name: el.name || el.id || "",
        isSelect, selector,
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      };
    }, index);

    if (elementInfo.error) return elementInfo;

    // For select elements
    if (elementInfo.isSelect) {
      await humanPause(page, 300, 600);
      await page.evaluate(({ index, value }) => {
        const selects = [];
        document.querySelectorAll("input, textarea, select").forEach((el) => {
          if (el.type === "hidden") return;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          selects.push(el);
        });
        const el = selects[index];
        el.value = value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, { index, value });
      return { filled: true, tag: "select", value };
    }

    // For text inputs: click first, pause, then type like a human
    if (elementInfo.selector) {
      try {
        const locator = page.locator(elementInfo.selector).first();
        // Move mouse to element first
        const box = await locator.boundingBox();
        if (box) {
          await humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2);
        }
        await locator.click();
        await humanPause(page, 200, 500);
        // Clear existing text
        await page.keyboard.press("Control+a");
        await humanPause(page, 100, 200);
        // Type like a human
        await humanType(page, value);
        await humanPause(page, 200, 500);
        return { filled: true, tag: elementInfo.tag, type: elementInfo.type, name: elementInfo.name, value };
      } catch {} // Fall through to coordinate-based approach
    }

    // Fallback: click coordinates then type like a human
    await humanMouseMove(page, elementInfo.x, elementInfo.y);
    await page.mouse.click(elementInfo.x, elementInfo.y);
    await humanPause(page, 200, 400);
    // Triple-click to select all existing text
    await page.mouse.click(elementInfo.x, elementInfo.y, { clickCount: 3 });
    await humanPause(page, 100, 200);
    await humanType(page, value);
    await humanPause(page, 200, 500);

    return { filled: true, tag: elementInfo.tag, type: elementInfo.type, name: elementInfo.name, value };
  } catch (err) {
    return { error: `fill failed: ${err.message}` };
  }
}

// ─── Click an Element ───────────────────────────────────

async function clickElement(index) {
  const page = await ensureBrowser();
  try {
    // Get element position for human mouse move
    const elemData = await page.evaluate((index) => {
      const elements = [];
      document.querySelectorAll("input, textarea, select").forEach((el) => {
        if (el.type === "hidden") return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        elements.push(el);
      });
      document.querySelectorAll("button, input[type='submit'], a[role='button'], [type='button'], a[href]").forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        if (el.tagName === "A" && !el.getAttribute("role") && el.innerText.trim().length < 2) return;
        if (el.tagName === "A" && !el.getAttribute("role") && !el.href) return;
        elements.push(el);
      });

      if (index < 0 || index >= elements.length) return { error: `Index ${index} out of range (0-${elements.length - 1})` };

      const el = elements[index];
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        text: el.innerText?.trim()?.slice(0, 50) || el.value || "",
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      };
    }, index);

    if (elemData.error) return elemData;

    // Human-like: move mouse, pause, then click
    await humanMouseMove(page, elemData.x, elemData.y);
    await humanPause(page, 100, 300);
    await page.mouse.click(elemData.x, elemData.y);

    // Wait for navigation or network activity
    await humanPause(page, 2000, 3500);
    try {
      await page.waitForLoadState("networkidle", { timeout: 5000 });
    } catch {}

    // Save cookies after clicks (may trigger login/cart changes)
    await saveCookies();
    return {
      clicked: true,
      tag: elemData.tag,
      text: elemData.text,
      current_url: page.url(),
      current_title: await page.title(),
    };
  } catch (err) {
    return { error: `click failed: ${err.message}` };
  }
}

// ─── Click by Text (more natural) ───────────────────────

async function clickText(text) {
  const page = await ensureBrowser();
  try {
    const strategies = [
      `text="${text}"`,
      `button:has-text("${text}")`,
      `a:has-text("${text}")`,
      `[role="button"]:has-text("${text}")`,
      `input[value="${text}"]`,
    ];

    for (const selector of strategies) {
      try {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 1000 })) {
          // Human-like: move to element then click
          const box = await el.boundingBox();
          if (box) {
            await humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2);
            await humanPause(page, 100, 300);
          }
          // Use mouse.click with coordinates to avoid Playwright's navigation wait hanging
          if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          } else {
            await el.click({ timeout: 10000 });
          }
          await humanPause(page, 2000, 3500);
          try {
            await page.waitForLoadState("networkidle", { timeout: 5000 });
          } catch {}
          // Save cookies after clicks
          await saveCookies();
          return {
            clicked: true,
            text,
            current_url: page.url(),
            current_title: await page.title(),
          };
        }
      } catch {}
    }

    return { error: `Could not find clickable element with text "${text}"` };
  } catch (err) {
    return { error: `click text failed: ${err.message}` };
  }
}

// ─── Click a Link by URL or partial URL ─────────────────

async function clickLink(urlPart) {
  const page = await ensureBrowser();
  try {
    const link = page.locator(`a[href*="${urlPart}"]`).first();
    if (await link.isVisible({ timeout: 2000 })) {
      const box = await link.boundingBox();
      if (box) {
        await humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2);
        await humanPause(page, 100, 300);
      }
      // Use mouse.click to avoid Playwright's navigation wait hanging on heavy JS sites
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      } else {
        await link.click({ timeout: 10000 });
      }
      await humanPause(page, 2000, 3500);
      try {
        await page.waitForLoadState("networkidle", { timeout: 5000 });
      } catch {}
      // Save cookies after link clicks
      await saveCookies();
      return {
        clicked: true,
        urlPart,
        current_url: page.url(),
        current_title: await page.title(),
      };
    }
    return { error: `No visible link matching "${urlPart}"` };
  } catch (err) {
    return { error: `click link failed: ${err.message}` };
  }
}

// ─── Type into focused/specific field ───────────────────

async function typeText(text, selector = null) {
  const page = await ensureBrowser();
  try {
    if (selector) {
      const locator = page.locator(selector).first();
      await locator.click();
      await humanPause(page, 200, 400);
      await humanType(page, text);
    } else {
      await humanType(page, text);
    }
    await humanPause(page, 200, 500);
    return { typed: true, text: text.slice(0, 50), selector: selector || "focused element" };
  } catch (err) {
    return { error: `type failed: ${err.message}` };
  }
}

// ─── Press keyboard keys ────────────────────────────────

async function pressKey(key) {
  const page = await ensureBrowser();
  try {
    await humanPause(page, 200, 500);
    await page.keyboard.press(key);
    await humanPause(page, 800, 2000);
    return { pressed: true, key };
  } catch (err) {
    return { error: `key press failed: ${err.message}` };
  }
}

// ─── Take Screenshot ────────────────────────────────────

async function takeScreenshot() {
  const page = await ensureBrowser();
  try {
    const screenshotDir = path.join(process.env.DATA_DIR || "./data", "screenshots");
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

    const filename = `screenshot_${Date.now()}.png`;
    const filepath = path.join(screenshotDir, filename);

    await page.screenshot({ path: filepath, fullPage: false });

    return {
      screenshot: filepath,
      url: page.url(),
      title: await page.title(),
      note: "Screenshot saved. Send this file to Sameh on Telegram if he wants to see it.",
    };
  } catch (err) {
    return { error: `screenshot failed: ${err.message}` };
  }
}

// ─── Select from Dropdown ───────────────────────────────

async function selectOption(index, value) {
  const page = await ensureBrowser();
  try {
    await humanPause(page, 300, 600);
    const result = await page.evaluate(({ index, value }) => {
      const selects = [...document.querySelectorAll("select")].filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (index < 0 || index >= selects.length) return { error: `Select index ${index} out of range` };
      const sel = selects[index];
      sel.value = value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return { selected: true, name: sel.name || sel.id, value };
    }, { index, value });
    return result;
  } catch (err) {
    return { error: `select failed: ${err.message}` };
  }
}

// ─── Wait for something ─────────────────────────────────

async function waitFor(selector, timeout = 5000) {
  const page = await ensureBrowser();
  try {
    await page.waitForSelector(selector, { timeout });
    return { found: true, selector };
  } catch {
    return { error: `Timed out waiting for "${selector}"` };
  }
}

// ─── Scroll the page ────────────────────────────────────

async function scrollPage(direction = "down", amount = 500) {
  const page = await ensureBrowser();
  try {
    // Scroll in smaller chunks like a human
    const chunks = Math.ceil(amount / 150);
    const chunkSize = Math.floor(amount / chunks);
    for (let i = 0; i < chunks; i++) {
      const delta = direction === "up" ? -chunkSize : chunkSize;
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(randomDelay(80, 200));
    }
    await humanPause(page, 300, 800);
    return { scrolled: true, direction, amount };
  } catch (err) {
    return { error: `scroll failed: ${err.message}` };
  }
}

module.exports = {
  navigate,
  readPage,
  getFormElements,
  fillField,
  clickElement,
  clickText,
  clickLink,
  typeText,
  pressKey,
  takeScreenshot,
  selectOption,
  waitFor,
  scrollPage,
  closeBrowser,
  saveCookies,
};
