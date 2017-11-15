import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { configuration } from "./configuration";
import { RestServer } from './interfaces/rest-server';
import { db } from "./db";
import { UserRecord, FileRecord } from "./interfaces/db-records";
import { UrlManager } from "./url-manager";
import * as Busboy from 'busboy';
import * as AWS from 'aws-sdk';
import * as s3Stream from "s3-upload-stream";
import * as uuid from "uuid";
import { KeyUtils } from "./key-utils";
import * as url from 'url';
import * as streamMeter from "stream-meter";

const MAX_CLOCK_SKEW = 1000 * 60 * 15;
export class FileManager implements RestServer {
  private app: express.Application;
  private urlManager: UrlManager;
  private s3StreamUploader: s3Stream.S3StreamUploader;
  private s3: AWS.S3;

  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    if (configuration.get('aws.s3.enabled')) {
      this.s3 = new AWS.S3({
        accessKeyId: configuration.get('aws.accessKeyId'),
        secretAccessKey: configuration.get('aws.secretAccessKey')
      });
      this.s3StreamUploader = s3Stream(this.s3);
    }
    this.urlManager = urlManager;
    this.app = app;
    this.registerHandlers();
  }

  private registerHandlers(): void {
    if (this.s3StreamUploader) {
      this.app.post(this.urlManager.getDynamicUrl('upload'), (request: Request, response: Response) => {
        void this.handleUpload(request, response);
      });
      this.app.get('/f/:fileId/:fileName', (request: Request, response: Response) => {
        void this.handleFetch(request, response);
      });
    }
  }

  private async handleUpload(request: Request, response: Response): Promise<void> {
    console.log("FileManager.handleUpload starting");
    const d = new Date();
    const fileRecord = await db.insertFile('started', configuration.get('aws.s3.bucket'));
    let ownerAddress: string;
    let signatureTimestamp: string;
    let signature: string;
    const busboy = new Busboy({ headers: request.headers });
    busboy.on('file', (fieldname: string, file: NodeJS.ReadableStream, filename: string, encoding: string, mimetype: string) => {
      console.log("FileManager.handleUpload starting file", filename);
      void this.handleUploadStart(file, filename, encoding, mimetype, fileRecord, ownerAddress, signatureTimestamp, signature, response);
    });
    busboy.on('field', (fieldname: string, val: any, fieldnameTruncated: boolean, valTruncated: boolean, encoding: string, mimetype: string) => {
      switch (fieldname) {
        case 'address':
          ownerAddress = val.toString();
          break;
        case 'signatureTimestamp':
          signatureTimestamp = val;
          break;
        case 'signature':
          signature = val.toString();
          break;
        default:
          break;
      }
    });
    request.pipe(busboy);
  }

  private async handleUploadStart(file: NodeJS.ReadableStream, filename: string, encoding: string, mimetype: string, fileRecord: FileRecord, ownerAddress: string, signatureTimestamp: string, signature: string, response: Response): Promise<void> {
    try {
      if (!ownerAddress || !signatureTimestamp || !signature) {
        response.status(400).send("Missing address, timestamp, and/or signature form fields");
        await this.abortFile(fileRecord);
        return;
      }
      const user = await db.findUserByAddress(ownerAddress);
      if (!user) {
        response.status(401).send("No such user");
        await this.abortFile(fileRecord);
        return;
      }
      if (Math.abs(Date.now() - Number(signatureTimestamp)) > MAX_CLOCK_SKEW) {
        response.status(400).send("Timestamp is inconsistent");
        await this.abortFile(fileRecord);
        return;
      }
      const publicKey = user.publicKey;
      if (!publicKey) {
        response.status(401).send("No such address");
        await this.abortFile(fileRecord);
        return;
      }
      if (!KeyUtils.verifyString(signatureTimestamp, publicKey, signature)) {
        response.status(403).send("Invalid signature");
        await this.abortFile(fileRecord);
        return;
      }
      console.log("FileManager.handleUpload uploading to S3", filename);
      await this.uploadS3(file, filename, encoding, mimetype, fileRecord, user, response);
    } catch (err) {
      console.error("File.handleUploadStart: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async abortFile(fileRecord: FileRecord): Promise<void> {
    await db.updateFileStatus(fileRecord, 'aborted');
  }

  private async uploadS3(file: NodeJS.ReadableStream, filename: string, encoding: string, mimetype: string, fileRecord: FileRecord, user: UserRecord, response: Response): Promise<void> {
    const d = new Date();
    let key = fileRecord.id;
    const meter = streamMeter();
    if (filename && filename.length > 0 && filename !== '/') {
      filename = filename.trim();
      if (filename.startsWith('/')) {
        filename = filename.substr(1);
      }
      key += '/' + filename;
    }
    const destination: AWS.S3.PutObjectRequest = {
      Bucket: configuration.get('aws.s3.bucket'),
      Key: key
    };
    if (mimetype) {
      destination.ContentType = mimetype;
    }
    let finished = false;
    destination.Tagging = "owner=" + user.id;
    await db.updateFileProgress(fileRecord, user.id, filename, encoding, mimetype, key, 'uploading');
    const upload = this.s3StreamUploader.upload(destination);
    upload.on('error', (err) => {
      console.warn("FileManager.uploadS3: upload failed", err);
      void db.updateFileStatus(fileRecord, 'failed');
      response.status(500).send("Internal error " + err);
    });
    upload.on('close', () => {
      console.log("FileManager.uploadS3: close", filename);
      if (!finished) {
        void db.updateFileStatus(fileRecord, 'aborted');
        response.status(500).send("S3 upload closed without completion");
      }
    });
    upload.on('uploaded', (details: any) => {
      console.log("FileManager.handleUpload upload to S3 completed", filename);
      void this.handleUploadCompleted(fileRecord, user, meter, key, response);
      finished = true;
    });
    file.pipe(meter).pipe(upload);
  }

  private async handleUploadCompleted(fileRecord: FileRecord, user: UserRecord, meter: streamMeter.StreamMeter, key: string, response: Response): Promise<void> {
    // const fileUrl = url.resolve(configuration.get('aws.s3.baseUrl'), key);
    const fileUrl = this.urlManager.getAbsoluteUrl('/f/' + key);
    await db.updateFileCompletion(fileRecord, 'complete', meter.bytes, fileUrl);
    await db.incrementUserStorage(user, meter.bytes);
    console.log("FileManager.uploadS3: upload completed", fileRecord.id);
    const reply = {
      fileId: fileRecord.id,
      url: fileUrl
    };
    console.log("FileManager.handleUpload sending response", reply);
    response.json(reply);
  }

  private async handleFetch(request: Request, response: Response): Promise<void> {
    console.log("FileManager.handleFetch", request.params.fileId, request.params.fileName);
    this.s3.getObject({
      Bucket: configuration.get('aws.s3.bucket'),
      Key: request.params.fileId + "/" + request.params.fileName
    }).on('httpHeaders', (statusCode: number, headers: { [key: string]: string }) => {
      response.set('Content-Length', headers['content-length']);
      response.set('Content-Type', headers['content-type']);
      response.set('Last-Modified', headers['last-modified']);
      response.set('ETag', headers['etag']);
      response.set('Accept-Ranges', headers['accept-ranges']);
      response.set('Content-Range', headers['content-range']);
      response.setHeader("Cache-Control", 'public, max-age=' + 60 * 60 * 24 * 30);
    }).createReadStream()
      .on('end', () => {
        console.log("FileManager.handleFetch completed");
        response.end();
      })
      .pipe(response);
  }
}

const fileManager = new FileManager();

export { fileManager };
