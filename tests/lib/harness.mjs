// Shared helpers for headless browser tests (smoke, raid, look-dev captures).

// A screenshot has to wait for a compositor frame, and on a slow CI runner the continuous software-rendered
// loop can starve it past Playwright's timeout. So: stop the game loop, capture, start it again.
// Three.js looks up window.requestAnimationFrame on every frame, so swapping it out pauses the loop and
// restoring it plus one call resumes it (renderer.setAnimationLoop keeps its callback).
export async function freezeAndScreenshot(page, path, { resume = false } = {}) {
  await page.evaluate(() => {
    window.__biophageRaf ??= window.requestAnimationFrame;
    window.__biophagePending = null;
    window.requestAnimationFrame = (cb) => { window.__biophagePending = cb; return 0; };
  });
  await page.screenshot({ path, timeout: 120000 });
  if (resume) {
    await page.evaluate(() => {
      window.requestAnimationFrame = window.__biophageRaf;
      const cb = window.__biophagePending;
      window.__biophagePending = null;
      if (cb) window.requestAnimationFrame(cb);
    });
  }
}
