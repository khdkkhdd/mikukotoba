import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTENSION_PATH = path.resolve(__dirname, '../../dist');
const YT_WATCH_URL = 'https://www.youtube.com/watch?v=gjljMFfzrA0';

let context: BrowserContext;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--disable-blink-features=AutomationControlled',
      '--lang=ja',
    ],
  });

  // Wait for the MV3 service worker to be ready
  const sw = context.serviceWorkers()[0]
    ?? await context.waitForEvent('serviceworker', { timeout: 10000 });

  // Pre-configure settings so extension starts in inline mode
  await sw.evaluate(() => {
    chrome.storage.sync.set({
      jp_settings: {
        enabled: true,
        webpageMode: 'inline',
        showFurigana: true,
        showRomaji: true,
        showTranslation: true,
      },
    });
  });
});

test.afterAll(async () => {
  await context?.close();
});

test('YouTube page handler detects and processes elements', async () => {
  const page = await context.newPage();

  // Collect console messages from content script
  const logs: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[ミク言葉]')) {
      logs.push(text);
    }
  });

  // Navigate to YouTube watch page
  await page.goto(YT_WATCH_URL, { waitUntil: 'domcontentloaded' });

  // Wait for YouTube to render the video title
  await page.waitForSelector('ytd-watch-metadata h1 yt-formatted-string', {
    timeout: 20000,
  });

  // Wait for the extension to process elements (delayed rescans at 500, 1500, 3000ms)
  await page.waitForTimeout(6000);

  // Print all ミク言葉 logs
  console.log('\n=== ミク言葉 Console Logs ===');
  for (const l of logs) {
    console.log(l);
  }
  console.log('=== End Logs ===\n');

  // Check: handler started
  const startLog = logs.find(l => l.includes('YouTube page handler starting'));
  expect(startLog).toBeTruthy();
  console.log('✓ Handler started:', startLog);

  // Check: scanExisting found elements (not 0)
  const scanLogs = logs.filter(l => l.includes('scanExisting done:'));
  const nonZeroScan = scanLogs.find(l => !l.includes('0 total'));
  console.log('  scanExisting results:');
  for (const l of scanLogs) console.log('    ', l);
  expect(nonZeroScan).toBeTruthy();

  // Check: no double start
  const startLogs = logs.filter(l => l.includes('YouTube page handler starting, mode:'));
  console.log(`\n⚠ start() called ${startLogs.length} time(s)`);
  for (const l of startLogs) console.log('  ', l);
  expect(startLogs.length).toBeLessThanOrEqual(2); // updateSettings + init at most

  // Check: processElement was called
  const processLogs = logs.filter(l => l.includes('processElement:'));
  console.log(`\n✓ processElement called ${processLogs.length} times`);
  for (const l of processLogs.slice(0, 15)) {
    console.log('  ', l);
  }

  // Check: "skip" reasons
  const skipLogs = logs.filter(l => l.includes('processElement skip:'));
  console.log(`\n⚠ processElement skipped ${skipLogs.length} times`);
  for (const l of skipLogs.slice(0, 10)) {
    console.log('  ', l);
  }

  // Check: deferToViewport was called
  const deferLogs = logs.filter(l => l.includes('deferToViewport:'));
  console.log(`\n✓ deferToViewport called ${deferLogs.length} times`);
  for (const l of deferLogs.slice(0, 15)) {
    console.log('  ', l);
  }

  // Check: viewport hit (elements entering viewport)
  const viewportLogs = logs.filter(l => l.includes('viewport hit:'));
  console.log(`\n✓ viewport hit ${viewportLogs.length} times`);
  for (const l of viewportLogs.slice(0, 10)) {
    console.log('  ', l);
  }

  // Check: translation failures
  const failLogs = logs.filter(l => l.includes('Translation failed'));
  console.log(`\n⚠ Translation failures: ${failLogs.length}`);
  for (const l of failLogs.slice(0, 5)) {
    console.log('  ', l);
  }

  // Check for translation injection in DOM
  const translationBlocks = await page.$$('[data-jp-yt-translation]');
  console.log(`\n✓ Translation blocks in DOM: ${translationBlocks.length}`);

  // Check for processed elements
  const processedEls = await page.$$('[data-jp-yt-processed]');
  console.log(`✓ Processed elements: ${processedEls.length}`);

  // Check video title specifically
  const videoTitle = await page.$('ytd-watch-metadata h1 yt-formatted-string');
  if (videoTitle) {
    const titleText = await videoTitle.innerText();
    console.log(`\n✓ Video title: "${titleText.slice(0, 60)}"`);

    // Check if title has translation sibling
    const titleTranslation = await page.$('ytd-watch-metadata h1 + [data-jp-yt-translation]');
    console.log(`✓ Title has translation block: ${titleTranslation ? 'YES' : 'NO'}`);
  }

  // Check comments
  const comments = await page.$$('#content-text.ytd-comment-renderer');
  console.log(`\n✓ Comment elements found: ${comments.length}`);
  const commentTranslations = await page.$$('#content-text.ytd-comment-renderer + [data-jp-yt-translation]');
  console.log(`✓ Comment translations: ${commentTranslations.length}`);

  // Check sidebar videos
  const sidebarTitles = await page.$$('ytd-compact-video-renderer #video-title');
  console.log(`\n✓ Sidebar video titles: ${sidebarTitles.length}`);

  // Summary
  const total = processLogs.length + deferLogs.length;
  console.log(`\n=== Summary: ${processLogs.length} processed, ${deferLogs.length} deferred, ${viewportLogs.length} viewport hits, ${translationBlocks.length} DOM blocks ===`);

  expect(total).toBeGreaterThan(0);

  await page.close();
});
