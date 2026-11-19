import { expect } from '@playwright/test';
import { test } from './fixtures.mjs';

const pendingText = '订单处理中，请勿重复提交';

test('成功提示须等待订单提交，订单号与 MySQL 逐位一致', async ({ page, scenario }, testInfo) => {
  const { shopId, voucherId, userId, title } = scenario;
  const purchasePath = `/api/voucher-order/seckill/${voucherId}`;
  const card = page.locator('.voucher-box').filter({ hasText: title });
  const button = card.locator('.voucher-btn');
  const history = () => page.evaluate(() => window.orderNotices);
  let submissions = 0;

  await page.goto(`/shop-detail.html?id=${shopId}`, { waitUntil: 'domcontentloaded' });
  await expect(button).toBeVisible();
  // Record transient notices as well as ones still present at assertion time.
  await page.evaluate(() => {
    window.orderNotices = [];
    const observer = new MutationObserver(() => {
      const lines = document.body.innerText.split('\n').map(line => line.trim());
      for (const line of lines.filter(text => /订单处理中|抢购成功/.test(text))) {
        if (!window.orderNotices.includes(line)) window.orderNotices.push(line);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  page.on('request', req => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === purchasePath) submissions++;
  });

  await scenario.holdStockLock();
  try {
    const purchaseResponse = page.waitForResponse(res =>
      res.request().method() === 'POST' && new URL(res.url()).pathname === purchasePath);
    await button.click();
    const accepted = await (await purchaseResponse).json();
    expect(accepted.success, '真实下单请求应已受理').toBe(true);

    // Old UI jumps directly to success. Report that product failure even if
    // the confirmation endpoint and pending UI have not been implemented yet.
    await expect.poll(history).not.toEqual([]);
    const heldOrderIds = await scenario.orderIds();
    expect(heldOrderIds).toEqual([]);
    const whileLocked = await history();
    expect(whileLocked.filter(text => text.includes('抢购成功')),
      `库存行锁仍持有，MySQL 订单为 ${JSON.stringify(heldOrderIds)}，页面提前提示成功`).toEqual([]);

    await expect(card.getByText(pendingText, { exact: true })).toBeVisible();
    await expect(button).toBeDisabled();
    expect(typeof accepted.data).toBe('string');
    const confirmationPath = `/api/voucher-order/${accepted.data}/confirmation`;
    const isConfirmation = res =>
      res.request().method() === 'GET' && new URL(res.url()).pathname === confirmationPath;
    // Use a real pointer on the disabled control. The next poll also gives a
    // duplicate request time to surface before counting submissions.
    const bounds = await button.boundingBox();
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    const pendingResponse = await page.waitForResponse(isConfirmation);
    expect(await pendingResponse.json()).toMatchObject({ success: true, data: { confirmed: false } });
    await expect(card.getByText(pendingText, { exact: true })).toBeVisible();
    expect(await scenario.orderIds()).toEqual([]);
    expect((await history()).filter(text => text.includes('抢购成功'))).toEqual([]);
    expect(submissions).toBe(1);

    await scenario.releaseStockLock();
    await expect.poll(() => scenario.orderIds(), { timeout: 10_000 }).toHaveLength(1);
    const [id] = await scenario.orderIds();
    expect(Number(id).toString(), '测试订单号必须能揭示 JS 数字精度损失').not.toBe(id);
    expect(accepted.data).toBe(id);
    const successMessage = page.getByText(/抢购成功.*[0-9]/).first();
    await expect(successMessage).toBeVisible();
    const shown = (await successMessage.innerText()).match(/[0-9]+/g);
    expect(shown, '成功提示中完整订单号应与 MySQL 一致').toEqual([id]);
    expect(submissions).toBe(1);
    console.log(JSON.stringify({ userId, voucherId, heldOrderIds, confirmedOrderId: id, displayed: shown[0] }));
  } catch (error) {
    const evidence = { userId, voucherId, submissions, notices: await history(), mysqlOrderIds: await scenario.orderIds() };
    console.error(JSON.stringify(evidence));
    await testInfo.attach('order-confirmation', { body: JSON.stringify(evidence), contentType: 'application/json' });
    throw error;
  }
});
