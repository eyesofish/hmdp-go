import { randomInt, randomUUID } from 'node:crypto';
import { expect, test as base } from '@playwright/test';
import mysql from 'mysql2/promise';
import { createClient } from 'redis';

// The test runner supplies ports from its own Compose project.
function isolatedPort(key) {
  const port = Number(process.env[key]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Missing test port ${key}. Run npm --prefix tests/e2e test.`);
  }
  return port;
}

export const test = base.extend({
  scenario: async ({ page, request }, use) => {
    const db = mysql.createPool({
      host: '127.0.0.1', port: isolatedPort('E2E_MYSQL_PORT'),
      user: 'root', database: 'hmdp', connectionLimit: 2,
    });
    const redis = createClient({ url: `redis://127.0.0.1:${isolatedPort('E2E_REDIS_PORT')}` });
    // This connection alone holds the row lock. Reads from db use autocommit.
    let lock;
    try {
      const phone = `139${String(randomInt(100_000_000)).padStart(8, '0')}`;
      const sent = await request.post('/api/user/code', { params: { phone } });
      expect((await sent.json()).success, 'send test login code').toBe(true);
      await redis.connect();
      const code = await redis.get('login:code:' + phone);
      if (!code) throw new Error('Test login code missing from isolated Redis');

      await page.goto('/login.html');
      await page.getByPlaceholder('请输入手机号').fill(phone);
      await page.getByPlaceholder('请输入验证码').fill(code);
      await page.getByRole('radio').check();
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.waitForURL('**/index.html');
      const [[user]] = await db.execute('SELECT id FROM tb_user WHERE phone = ?', [phone]);
      const title = 'E2E-' + randomUUID();
      const shopId = 1;
      const day = 24 * 60 * 60 * 1000;
      const created = await request.post('/api/voucher/seckill', { data: {
        shopId, title, type: 1, status: 1, stock: 1, payValue: 100, actualValue: 200,
        beginTime: new Date(Date.now() - day).toISOString(),
        endTime: new Date(Date.now() + day).toISOString(),
      } });
      const voucher = await created.json();
      expect(voucher.success, 'create valid test voucher').toBe(true);
      const voucherId = voucher.data;
      await use({
        userId: user.id, voucherId, shopId, title,
        async holdStockLock() {
          lock = await db.getConnection();
          await lock.beginTransaction();
          const [rows] = await lock.execute(
            'SELECT stock, NOW() BETWEEN begin_time AND end_time AS active ' +
            'FROM tb_seckill_voucher WHERE voucher_id = ? FOR UPDATE', [voucherId],
          );
          expect(rows).toEqual([{ stock: 1, active: 1 }]);
        },
        async releaseStockLock() {
          await lock.rollback();
          lock.release();
          lock = undefined;
        },
        async orderIds() {
          const [rows] = await db.execute(
            'SELECT CAST(id AS CHAR) AS id FROM tb_voucher_order WHERE user_id = ? AND voucher_id = ?',
            [user.id, voucherId],
          );
          return rows.map(row => row.id);
        },
      });
    } finally {
      // Disconnecting the lock session also rolls back an unfinished transaction.
      lock?.destroy();
      if (redis.isOpen) await redis.quit();
      await db.end();
    }
  },
});
