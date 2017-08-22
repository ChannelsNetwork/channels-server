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

const SNS_NOTIFY_OFFSET = 'snsNotify';
export class AwsManager implements RestServer, Initializable {
  private sns: AWS.SNS;
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
      switch (type) {
        case 'SubscriptionConfirmation':
          const confirmation = JSON.parse(request.body);
          // TODO: verify signature
          this.sns.confirmSubscription({
            TopicArn: confirmation.TopicArn,
            Token: confirmation.Token
          }, (err: any) => {
            if (err) {
              throw err;
            }
          });
          break;
        case 'Notification':
          const notification = JSON.parse(request.body);
          // TODO: verify signature
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
