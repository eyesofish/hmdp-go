import { expect } from '@playwright/test';
import { test } from './fixtures.mjs';

test('状态查询暂时断网后继续等待，确认成功后停止轮询', async ({ page, scenario }) => {
  const confirmation = '**/api/voucher-order/*/confirmation';
  let reads = 0;
  await page.route(confirmation, route => {
    reads++;
    if (reads === 1) return route.abort('connectionreset');
    return route.continue();
  });
  await page.clock.install();
  await page.goto(`/shop-detail.html?id=${scenario.shopId}`, { waitUntil: 'domcontentloaded' });
  const card = page.locator('.voucher-box').filter({ hasText: scenario.title });
  const button = card.locator('.voucher-btn');
  await scenario.holdStockLock();

  // This can resolve only on a later, successful GET. The first is aborted.
  const retry = page.waitForResponse(confirmation);
  await button.click();
  expect(await (await retry).json()).toMatchObject({ success: true, data: { confirmed: false } });
  expect(reads).toBeGreaterThanOrEqual(2);
  await expect(card.getByText('订单处理中，请勿重复提交', { exact: true })).toBeVisible();
  await expect(button).toBeDisabled();
  await scenario.releaseStockLock();

  await expect(card.getByText(/抢购成功.*[0-9]/)).toBeVisible();
  const finalReadCount = reads;
  await page.clock.runFor(2500); // Advance beyond two scheduled 1-second polls.
  expect(reads, '成功提示出现后仍有确认查询').toBe(finalReadCount);
});
