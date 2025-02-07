import {createTransport, Transporter} from 'nodemailer';
import {
  SESv2Client,
  SESv2ClientConfig,
  SendEmailCommand,
  SendEmailCommandInput,
  SendEmailCommandOutput,
} from '@aws-sdk/client-sesv2';

export type Message = {
  subject: string;
  text: string;
  to: string;
  from: string;
  attachments?: Attachment[];
};

export type Attachment = {
  contentType: string;
  data: Buffer;
  filename: string;
};

export class SESClient {
  private client: SESv2Client;
  private transporter: Transporter;

  constructor(config?: SESv2ClientConfig) {
    this.client = new SESv2Client(config || {});
    this.transporter = createTransport({
      streamTransport: true, // Generate raw email instead of sending
      newline: 'unix',
    });
  }

  async sendEmail(): Promise<SendEmailCommandOutput> {
    const message = await this.transporter.sendMail({});

    const input: SendEmailCommandInput = {
      Content: {
        Raw: {
          Data: Buffer.from(message.toString()),
        },
      },
    };
    return await this.client.send(new SendEmailCommand(input));
  }

  // createRawEmail({subject, to, from, attachments = []}: Message) {
  //   const boundary =
  //     '----=_NextPart_' + Math.random().toString(36).substring(2); // Generate a unique boundary

  //   let rawEmail = `
  // From: ${from}
  // To: ${to}
  // Subject: ${subject}
  // MIME-Version: 1.0
  // Content-Type: multipart/mixed; boundary="${boundary}"

  // --${boundary}
  // Content-Type: text/html; charset="UTF-8"

  // ${htmlBody}

  // `;

  //   for (const attachment of attachments) {
  //     const base64EncodedData = Buffer.from(attachment.data).toString('base64'); // Important: Use Buffer for binary data
  //     rawEmail += `
  // --${boundary}
  // Content-Type: ${attachment.contentType}; name="${attachment.filename}"
  // Content-Transfer-Encoding: base64
  // Content-Disposition: attachment; filename="${attachment.filename}"

  // ${base64EncodedData}

  // `;
  //   }

  //   rawEmail += `--${boundary}--`; // Close the multipart message

  //   return rawEmail;
  // }
}
