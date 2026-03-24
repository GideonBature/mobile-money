export class AirtelProvider {
  async requestPayment(_phoneNumber: string, _amount: string) {
    return { success: true };
  }

  async sendPayout(_phoneNumber: string, _amount: string) {
    return { success: true };
  }
}
