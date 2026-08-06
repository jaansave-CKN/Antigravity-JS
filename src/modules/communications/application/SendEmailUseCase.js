export class SendEmailUseCase {
  constructor(emailAdapter) {
    this.emailAdapter = emailAdapter;
  }

  async execute(to, subject, content) {
    return await this.emailAdapter.send(to, subject, content);
  }
}
