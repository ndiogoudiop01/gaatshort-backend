export const SMS_SENDER = Symbol('SMS_SENDER');

export interface SmsPort {
  send(params: { to: string; body: string }): Promise<{ providerId: string }>;
}
