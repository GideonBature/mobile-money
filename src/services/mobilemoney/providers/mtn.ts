import axios from 'axios';

export class MTNProvider {
  private apiKey: string;
  private apiSecret: string;
  private subscriptionKey: string;
  private baseUrl = 'https://sandbox.momodeveloper.mtn.com';

  constructor() {
    this.apiKey = process.env.MTN_API_KEY || '';
    this.apiSecret = process.env.MTN_API_SECRET || '';
    this.subscriptionKey = process.env.MTN_SUBSCRIPTION_KEY || '';
  }

  async requestPayment(phoneNumber: string, amount: string) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/collection/v1_0/requesttopay`,
        {
          amount,
          currency: 'EUR',
          externalId: Date.now().toString(),
          payer: { partyIdType: 'MSISDN', partyId: phoneNumber },
          payerMessage: 'Payment for Stellar deposit',
          payeeNote: 'Deposit'
        },
        {
          headers: {
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
            'X-Target-Environment': 'sandbox'
          }
        }
      );

      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error };
    }
  }

  async sendPayout(_phoneNumber: string, _amount: string) {
    return { success: true };
  }
}
