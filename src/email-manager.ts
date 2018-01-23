import * as nodemailer from 'nodemailer';
import { Initializable } from './interfaces/initializable';
import url = require('url');
import { UrlManager } from "./url-manager";
import { configuration } from "./configuration";
import path = require('path');
import * as Mustache from 'mustache';
import fs = require('fs');

export interface EmailButton {
  caption: string;
  url: string;
}

export class EmailManager implements Initializable {
  private transporter: nodemailer.Transporter;
  private baseHtmlTemplate: string;
  private baseTextTemplate: string;
  private buttonHtmlTemplate: string;
  private buttonTextTemplate: string;

  async initialize(urlManager: UrlManager): Promise<void> {
    if (configuration.get('aws.ses') && !configuration.get('email.disabled')) {
      const smtpConfig = {
        host: 'email-smtp.us-east-1.amazonaws.com',
        port: 465,
        secure: true, // use SSL
        auth: {
          user: configuration.get('aws.ses.smtpUserName'),
          pass: configuration.get('aws.ses.smtpPassword')
        }
      };
      this.transporter = nodemailer.createTransport(smtpConfig);
    }
    this.baseHtmlTemplate = fs.readFileSync(path.join(__dirname, '../templates/email/base.html'), 'utf8');
    this.baseTextTemplate = fs.readFileSync(path.join(__dirname, '../templates/email/base.txt'), 'utf8');
    this.buttonHtmlTemplate = fs.readFileSync(path.join(__dirname, '../templates/email/button.html'), 'utf8');
    this.buttonTextTemplate = fs.readFileSync(path.join(__dirname, '../templates/email/button.txt'), 'utf8');
  }

  async initialize2(): Promise<void> {
    // noop
  }

  async sendUsingTemplate(fromName: string, fromEmail: string, toName: string, toEmail: string, subject: string, templateName: string, info: any, buttons: EmailButton[], skipSignature: boolean = false): Promise<void> {
    const baseHtml = this.baseHtmlTemplate;
    const baseText = this.baseTextTemplate;

    let data = fs.readFileSync(path.join(__dirname, '../modules/templates/email/' + templateName + '.txt'), 'utf8');
    const textBody = Mustache.render(data, info);
    data = fs.readFileSync(path.join(__dirname, '../modules/templates/email/' + templateName + '.html'), 'utf8');
    const htmlBody = Mustache.render(data, info);

    let buttonsBodyHtml = "";
    let buttonsBodyText = "";
    if (buttons && buttons.length) {
      const buttonHtml = this.buttonHtmlTemplate;
      const buttonText = this.buttonTextTemplate;
      for (const button of buttons) {
        const binfo: any = {
          caption: button.caption,
          url: button.url
        };
        buttonsBodyHtml += Mustache.render(buttonHtml, binfo);
        buttonsBodyText += Mustache.render(buttonText, binfo);
      }
    }

    const logoUrl = url.resolve(configuration.get('baseClientUri'), '/s/images/logo-wide.png');
    const htmlContent = Mustache.render(baseHtml, {
      messageBody: htmlBody,
      buttons: buttonsBodyHtml,
      signature: "",
      tagLine: "",
      logoUrl: logoUrl
    });
    const textContent = Mustache.render(baseText, {
      messageBody: textBody,
      buttons: buttonsBodyText,
      signature: ""
    });

    await this.send(fromName, fromEmail, toName, toEmail, subject, textContent, htmlContent);
  }

  async sendInternalNotification(subject: string, text: string, html: string): Promise<void> {
    await this.send("Channels Server", "no-reply@channels.cc", "Channels Operations", "notifications@ChannelElements.emailchannels.us", subject, text, html);
  }

  async sendNoReplyUserNotification(toName: string, toEmail: string, subject: string, text: string, html: string): Promise<void> {
    await this.send("Channels Operations", "no-reply@channels.cc", toName, toEmail, subject, text, html);
  }

  async send(fromName: string, fromEmail: string, toName: string, toEmail: string, subject: string, text: string, html: string): Promise<void> {
    if (this.transporter) {
      let from = '<' + fromEmail + '>';
      if (fromName) {
        from = '"' + fromName + '" ' + from;
      }
      let to = '<' + toEmail + '>';
      if (toName) {
        to = '"' + toName + '" ' + to;
      }
      await this.transporter.sendMail({
        from: from,
        to: to,
        subject: subject,
        text: text,
        html: html
      });
    }
  }
}

const emailManager = new EmailManager();

export { emailManager };
