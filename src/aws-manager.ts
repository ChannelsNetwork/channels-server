import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import * as AWS from 'aws-sdk';
import { configuration } from './configuration';
import * as url from 'url';
import { RestServer } from "./interfaces/rest-server";
import { UrlManager } from "./url-manager";
import { Initializable } from "./interfaces/initializable";
import { message } from "aws-sdk/clients/sns";
const SnsMessageValidator = require('sns-validator');

const SNS_NOTIFY_OFFSET = 'snsNotify';
export class AwsManager implements RestServer, Initializable {
  private sns: AWS.SNS;
  private snsValidator = new SnsMessageValidator();
  private app: express.Application;
  private urlManager: UrlManager;
  private handlers: NotificationHandler[] = [];

  async initialize(): Promise<void> {
    // noop
  }

  registerNotificationHandler(handler: NotificationHandler): void {
    this.handlers.push(handler);
  }

  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    this.urlManager = urlManager;
    this.app = app;
    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.app.post(this.urlManager.getDynamicUrl(SNS_NOTIFY_OFFSET), (request: Request, response: Response) => {
      void this.handleSnsNotify(request, response);
    });
  }

  async initialize2(): Promise<void> {
    if (configuration.get('aws.accessKeyId') && configuration.get('aws.secretAccessKey')) {
      AWS.config.update({
        accessKeyId: configuration.get('aws.accessKeyId'),
        secretAccessKey: configuration.get('aws.secretAccessKey')
      });
      if (configuration.get('aws.sns.topic')) {
        this.sns = new AWS.SNS();
        this.sns.subscribe({
          Protocol: configuration.get('serverId').split(':')[0],
          TopicArn: configuration.get('aws.sns.topic'),
          Endpoint: url.resolve(configuration.get('serverId'), '/d/snsNotify')
        }, (err: any) => {
          if (err) {
            throw err;
          }
        });
      }
    }
  }

  private async handleSnsNotify(request: Request, response: Response): Promise<void> {
    const type = request.headers['x-amz-sns-message-type'];
    if (type) {
      let snsMessage: any;
      try {
        snsMessage = await this.validateSnsMessage(request.body);
      } catch (err) {
        console.error("AwsManager.handleSnsNotify: received invalid SNS message", err);
        return;
      }
      switch (type) {
        case 'SubscriptionConfirmation':
          const confirmation = snsMessage;
          this.sns.confirmSubscription({
            TopicArn: confirmation.TopicArn,
            Token: confirmation.Token
          }, (err: any) => {
            if (err) {
              console.error("AwsManager.handleSnsNotify: error confirming subscription", err);
            }
          });
          break;
        case 'Notification':
          const notification = snsMessage;
          const subject = notification.Subject as string;
          const msg = JSON.parse(notification.Message as string) as ChannelsServerNotification;
          await this.processNotification(msg);
          break;
        default:
          console.warn("Received unexpected SNS request type", type);
      }
    } else {
      console.warn("Received unexpected SNS request");
    }
  }

  private validateSnsMessage(snsMessageBody: any): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      const snsMessage = JSON.parse(snsMessageBody);
      this.snsValidator.validate(snsMessage, (err: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(snsMessage);
        }
      });
    });
  }

  private async processNotification(notification: ChannelsServerNotification): Promise<void> {
    for (const handler of this.handlers) {
      await handler.handleNotification(notification);
    }
  }

  async sendSns(notification: ChannelsServerNotification): Promise<void> {
    if (this.sns) {
      this.sns.publish({
        TopicArn: configuration.get('aws.sns.topic'),
        Message: JSON.stringify(notification),
      }, (err: any) => {
        console.error("Failure publishing SNS notification", err);
      });
    } else {
      // Bypass SNS and just process locally
      await this.processNotification(notification);
    }
  }
}

export interface NotificationHandler {
  handleNotification(notification: ChannelsServerNotification): Promise<void>;
}

export interface ChannelsServerNotification {
  type: "card-posted" | "mutation";
  user: string;
  card: string;
  mutation?: string;
}

const awsManager = new AwsManager();

export { awsManager };
