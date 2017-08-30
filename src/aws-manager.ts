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
import * as bodyParser from "body-parser";
import { Utils } from "./utils";
const SnsMessageValidator = require('sns-validator');

const SNS_NOTIFY_OFFSET = 'snsNotify';
export class AwsManager implements RestServer, Initializable {
  private sns: AWS.SNS;
  private snsValidator = new SnsMessageValidator();
  private app: express.Application;
  private urlManager: UrlManager;
  private handlers: NotificationHandler[] = [];
  private snsConfirmed = false;

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

    this.app.post(this.urlManager.getDynamicUrl(SNS_NOTIFY_OFFSET), bodyParser.text(), (request: Request, response: Response) => {
      void this.handleSnsNotify(request, response);
    });
  }

  async initialize2(): Promise<void> {
    if (configuration.get('aws.accessKeyId') && configuration.get('aws.secretAccessKey')) {
      AWS.config.update({
        accessKeyId: configuration.get('aws.accessKeyId'),
        secretAccessKey: configuration.get('aws.secretAccessKey'),
        region: configuration.get('aws.region', 'us-east-1')
      });
      if (configuration.get('aws.sns.topic')) {
        this.sns = new AWS.SNS();
        console.log("AwsManager.initialize2: Subscribing to SNS topic " + configuration.get('aws.sns.topic'));
        this.sns.subscribe({
          Protocol: configuration.get('aws.sns.callbackBaseUrl').split(':')[0],
          TopicArn: configuration.get('aws.sns.topic'),
          Endpoint: url.resolve(configuration.get('aws.sns.callbackBaseUrl'), '/d/' + SNS_NOTIFY_OFFSET)
        }, (err: any) => {
          if (err) {
            throw err;
          }
        });
        setTimeout(() => {
          if (!this.snsConfirmed) {
            throw new Error("AwsManager: 30 seconds after subscribing, SNS subscription has not been confirmed");
          }
        }, 30000);
      }
    }
  }

  private async handleSnsNotify(request: Request, response: Response): Promise<void> {
    try {
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
            console.log("AwsManager.handleSnsNotify: Confirming SNS subscription", JSON.stringify(snsMessage));
            this.sns.confirmSubscription({
              TopicArn: confirmation.TopicArn,
              Token: confirmation.Token
            }, (err: any) => {
              if (err) {
                console.error("AwsManager.handleSnsNotify: error confirming subscription", err);
              } else {
                this.snsConfirmed = true;
                console.log("AwsManager.handleSnsNotify: subscription confirmed");
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
        response.status(200).end();
      } else {
        console.warn("Received unexpected SNS request");
        response.status(400).send("Unexpected SNS request");
      }
    } catch (err) {
      console.error("Aws.handleSnsNotify: Failure", err);
      response.status(500).send(err);
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
    console.log("AwsManager.processNotification", JSON.stringify(notification));
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
        if (err) {
          console.error("Failure publishing SNS notification", err);
        }
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
