import { MTNProvider } from './providers/mtn';
import { AirtelProvider } from './providers/airtel';
import { OrangeProvider } from './providers/orange';

interface MobileMoneyProvider {
  requestPayment(phoneNumber: string, amount: string): Promise<{ success: boolean; data?: unknown; error?: unknown }>;
  sendPayout(phoneNumber: string, amount: string): Promise<{ success: boolean; data?: unknown; error?: unknown }>;
}

export class MobileMoneyService {
  private providers: Map<string, MobileMoneyProvider>;

  constructor() {
    this.providers = new Map([
      ['mtn', new MTNProvider()],
      ['airtel', new AirtelProvider()],
      ['orange', new OrangeProvider()]
    ]);
  }

  async initiatePayment(provider: string, phoneNumber: string, amount: string) {
    const providerInstance = this.providers.get(provider.toLowerCase());
    
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not supported`);
    }

    return await providerInstance.requestPayment(phoneNumber, amount);
  }

  async sendPayout(provider: string, phoneNumber: string, amount: string) {
    const providerInstance = this.providers.get(provider.toLowerCase());
    
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not supported`);
    }

    return await providerInstance.sendPayout(phoneNumber, amount);
  }
}
