import { UnoPay, ZarinpalAdapter } from './dist/index.js';

async function run() {
  const logger = {
    info: (msg: string, ctx?: any) => console.log(`[INFO] ${msg}`),
    error: (msg: string, ctx?: any) => console.error(`[ERROR] ${msg}`),
    warn: (msg: string, ctx?: any) => console.warn(`[WARN] ${msg}`),
    debug: (msg: string, ctx?: any) => console.log(`[DEBUG] ${msg}`),
  };

  const unopay = new UnoPay({
    zarinpal: new ZarinpalAdapter({ merchantId: 'test', sandbox: true })
  }, logger);

  console.log('--- Creating Payment ---');
  try {
    const result = await unopay.createPayment('zarinpal', {
      amount: 1000,
      currency: 'IRT',
      callbackUrl: 'https://example.com/callback'
    });
    console.log('Result:', result);
  } catch (e) {
    console.error(e);
  }
}

run().catch(console.error);
