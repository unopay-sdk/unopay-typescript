import { describe, it, expect, vi, afterEach } from 'vitest';
import { BehpardakhtAdapter } from '../../src/adapters/behpardakht.js';
import { PaymentValidationError, GatewayNetworkError, GatewayProviderError } from '../../src/errors.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const CREDS = { terminalId: '123456', username: 'sandbox', password: 'sandbox' };
const SANDBOX = { ...CREDS, baseUrl: 'http://localhost:8080/behpardakht' };

function soapXml(body: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">\n' +
    '  <soapenv:Body>\n' +
    body +
    '\n  </soapenv:Body>\n</soapenv:Envelope>'
  );
}

function okText(xml: string) {
  return vi.fn().mockResolvedValue({ ok: true, text: async () => xml } as any);
}

describe('BehpardakhtAdapter', () => {
  it('requires terminalId, username and password', () => {
    expect(() => new BehpardakhtAdapter({ ...CREDS, password: '' })).toThrow(PaymentValidationError);
  });

  it('initiates via SOAP bpPaymentRequest with credentials and builds redirect from baseUrl', async () => {
    const adapter = new BehpardakhtAdapter(SANDBOX);
    global.fetch = okText(
      soapXml(
        '    <bpPaymentRequestResponse>' +
          '<ResCode>0</ResCode>' +
          '<RefId>9988776655</RefId>' +
          '<RedirectUrl>http://localhost:8080/behpardakht/checkout/9988776655</RedirectUrl>' +
          '</bpPaymentRequestResponse>'
      )
    );

    const result = await adapter.createPayment({
      amount: 1000,
      currency: 'IRR',
      callbackUrl: 'http://cb',
      metadata: { description: 'order 1' },
    });

    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('http://localhost:8080/behpardakht/MellatPaymentGateway');
    expect(init.headers['Content-Type']).toContain('text/xml');
    expect(init.body).toContain('<bpPaymentRequest>');
    expect(init.body).toContain('<terminalId>123456</terminalId>');
    expect(init.body).toContain('<userName>sandbox</userName>');
    expect(init.body).toContain('<userPassword>sandbox</userPassword>');
    expect(init.body).toContain('<amount>1000</amount>');
    expect(init.body).toContain('<callBackUrl>http://cb</callBackUrl>');
    expect(result.transactionId).toBe('9988776655');
    expect(result.redirectUrl).toBe('http://localhost:8080/behpardakht/checkout/9988776655');
  });

  it('rewrites the sandbox hardcoded-localhost RedirectUrl onto a cloud host', async () => {
    const adapter = new BehpardakhtAdapter({ ...CREDS, baseUrl: 'https://cloud.example/behpardakht' });
    global.fetch = okText(
      soapXml(
        '<bpPaymentRequestResponse><ResCode>0</ResCode><RefId>R1</RefId>' +
          '<RedirectUrl>http://localhost:8080/behpardakht/checkout/R1</RedirectUrl>' +
          '</bpPaymentRequestResponse>'
      )
    );

    const result = await adapter.createPayment({ amount: 1, currency: 'IRR', callbackUrl: 'cb' });
    expect(result.redirectUrl).toBe('https://cloud.example/behpardakht/checkout/R1');
  });

  it('sends X-Sandbox-Scenario on initiate only when configured', async () => {
    const adapter = new BehpardakhtAdapter({ ...SANDBOX, scenario: 'pending_settle' });
    global.fetch = okText(soapXml('<bpPaymentRequestResponse><ResCode>0</ResCode><RefId>R2</RefId></bpPaymentRequestResponse>'));

    await adapter.createPayment({ amount: 1, currency: 'IRR', callbackUrl: 'cb' });
    expect((global.fetch as any).mock.calls[0][1].headers['X-Sandbox-Scenario']).toBe('pending_settle');
  });

  it('maps ResCode 59 to GatewayNetworkError', async () => {
    const adapter = new BehpardakhtAdapter({ ...SANDBOX, scenario: 'timeout' });
    global.fetch = okText(soapXml('<bpPaymentRequestResponse><ResCode>59</ResCode><RefId></RefId></bpPaymentRequestResponse>'));

    const err = await adapter
      .createPayment({ amount: 1, currency: 'IRR', callbackUrl: 'cb' })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayNetworkError);
  });

  it('rejects non-zero initiate ResCode as GatewayProviderError', async () => {
    const adapter = new BehpardakhtAdapter(SANDBOX);
    const xml = soapXml('<bpPaymentRequestResponse><ResCode>11</ResCode><RefId></RefId></bpPaymentRequestResponse>');
    global.fetch = okText(xml);

    const err = await adapter
      .createPayment({ amount: 1, currency: 'IRR', callbackUrl: 'cb' })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayProviderError);
    expect((err as GatewayProviderError).cause).toBe(xml);
  });

  it('fails fast from a non-zero checkout ResCode without calling verify', async () => {
    const adapter = new BehpardakhtAdapter(SANDBOX);
    global.fetch = okText('');

    const result = await adapter.verifyCallback({
      method: 'GET',
      query: { ResCode: '11', RefId: 'R1' },
      body: {},
    });
    expect(result.isSuccessful).toBe(false);
    expect(result.errorReason).toContain('ResCode 11');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('verifies with saleOrderId/RefId from the callback (ResCode 0 = success)', async () => {
    const adapter = new BehpardakhtAdapter(SANDBOX);
    global.fetch = okText(soapXml('<bpPaymentVerificationResponse><ResCode>0</ResCode></bpPaymentVerificationResponse>'));

    const result = await adapter.verifyCallback({
      method: 'GET',
      query: { ResCode: '0', RefId: 'R9', SaleOrderId: '1712345', SaleReferenceId: '200001' },
      body: {},
    });
    expect(result.isSuccessful).toBe(true);
    const body = (global.fetch as any).mock.calls[0][1].body;
    expect(body).toContain('<bpPaymentVerification>');
    expect(body).toContain('<saleOrderId>1712345</saleOrderId>');
    expect(body).toContain('<saleReferenceId>200001</saleReferenceId>');
  });

  it('treats duplicate verify ResCode 101 as success', async () => {
    const adapter = new BehpardakhtAdapter(SANDBOX);
    global.fetch = okText(soapXml('<bpPaymentVerificationResponse><ResCode>101</ResCode></bpPaymentVerificationResponse>'));

    const result = await adapter.verifyCallback({ method: 'GET', query: { RefId: 'R1' }, body: {} });
    expect(result.isSuccessful).toBe(true);
  });

  it('requires RefId for verification', async () => {
    const adapter = new BehpardakhtAdapter(SANDBOX);
    await expect(adapter.verifyCallback({ method: 'GET', query: {}, body: {} })).rejects.toThrow(
      PaymentValidationError
    );
  });

  it('refunds via bpReverseTransaction keyed on transactionId (0 = success, 45 = failure)', async () => {
    const adapter = new BehpardakhtAdapter(SANDBOX);
    global.fetch = okText(soapXml('<bpReverseTransactionResponse><ResCode>0</ResCode></bpReverseTransactionResponse>'));
    const ok = await adapter.refund({ transactionId: 'R1' });
    expect(ok.isSuccessful).toBe(true);
    expect((global.fetch as any).mock.calls[0][1].body).toContain('<saleOrderId>R1</saleOrderId>');

    global.fetch = okText(soapXml('<bpReverseTransactionResponse><ResCode>45</ResCode></bpReverseTransactionResponse>'));
    const bad = await adapter.refund({ transactionId: 'R1' });
    expect(bad.isSuccessful).toBe(false);
    expect(bad.errorReason).toContain('45');
  });
});
