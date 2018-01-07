import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { configuration } from "./configuration";
import { RestServer } from './interfaces/rest-server';
import { db } from "./db";
import { UserRecord, FileRecord, ImageDescription } from "./interfaces/db-records";
import { UrlManager } from "./url-manager";
import * as Busboy from 'busboy';
import * as s3Stream from "s3-upload-stream";
import * as uuid from "uuid";
import { KeyUtils } from "./key-utils";
import * as url from 'url';
import * as streamMeter from "stream-meter";
import { GetObjectRequest } from "aws-sdk/clients/s3";
import { DiscardFilesDetails, DiscardFilesResponse, RestRequest, FileInfo, FileUploadResponse } from "./interfaces/rest-services";
import { SERVER_VERSION } from "./server-version";
import { RestHelper } from "./rest-helper";
import * as AWS from 'aws-sdk';
import * as LRU from 'lru-cache';

const MAX_CLOCK_SKEW = 1000 * 60 * 15;
const FILE_URL_LIFETIME_SECONDS = 60 * 60 * 4;
const FILE_URL_CACHE_LIFETIME_SECONDS = 60 * 60 * 3;
export class FileManager implements RestServer {
  private app: express.Application;
  private urlManager: UrlManager;
  private s3StreamUploader: s3Stream.S3StreamUploader;
  private s3: AWS.S3;
  private fileUrlCache = LRU<string, FileUrlInfo>({ max: 100000, maxAge: 1000 * FILE_URL_CACHE_LIFETIME_SECONDS });

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
      // Following is now only to support developer machines.  In deployed version, files are served directly from S3 by CloudFront
      this.app.get('/f/:fileId/:fileName', (request: Request, response: Response) => {
        void this.handleFetch(request, response);
      });
      this.app.post(this.urlManager.getDynamicUrl('discard-files'), (request: Request, response: Response) => {
        void this.handleDiscardFiles(request, response);
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
    let requestedFileName: string;
    let imageInfo: ImageDescription;
    let creatorKey: string;
    const busboy = new Busboy({ headers: request.headers });
    busboy.on('file', (fieldname: string, file: NodeJS.ReadableStream, filename: string, encoding: string, mimetype: string) => {
      const fName = requestedFileName || filename || "unnamed";
      console.log("FileManager.handleUpload starting file", fName);
      void this.handleUploadStart(file, fName, encoding, mimetype, imageInfo, creatorKey, fileRecord, ownerAddress, signatureTimestamp, signature, response);
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
        case 'fileName':
          requestedFileName = val.toString();
          break;
        case 'creatorKey':
          creatorKey = val.toString();
          break;
        case 'imageWidth':
          if (!imageInfo) {
            imageInfo = { width: 0, height: 0 };
          }
          imageInfo.width = Number(val);
          break;
        case 'imageHeight':
          if (!imageInfo) {
            imageInfo = { width: 0, height: 0 };
          }
          imageInfo.height = Number(val);
          break;
        default:
          break;
      }
    });
    request.pipe(busboy);
  }

  private async handleUploadStart(file: NodeJS.ReadableStream, filename: string, encoding: string, mimetype: string, imageInfo: ImageDescription, creatorKey: string, fileRecord: FileRecord, ownerAddress: string, signatureTimestamp: string, signature: string, response: Response): Promise<void> {
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
      await this.uploadS3(file, filename, encoding, mimetype, imageInfo, creatorKey, fileRecord, user, response);
    } catch (err) {
      console.error("File.handleUploadStart: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async abortFile(fileRecord: FileRecord): Promise<void> {
    await db.updateFileStatus(fileRecord, 'aborted');
  }

  private async uploadS3(file: NodeJS.ReadableStream, filename: string, encoding: string, mimetype: string, imageInfo: ImageDescription, creatorKey: string, fileRecord: FileRecord, user: UserRecord, response: Response): Promise<void> {
    const d = new Date();
    let key = fileRecord.id;
    const meter = streamMeter();
    if (!filename) {
      filename = "content";
    }
    filename = filename.trim();
    filename = filename.split(/[^a-zA-Z0-9_\.\-]/).join("");  // Don't want weird characters in filename
    key += '/' + filename;
    const destination: AWS.S3.PutObjectRequest = {
      Bucket: configuration.get('aws.s3.bucket'),
      Key: key
    };
    if (mimetype) {
      destination.ContentType = mimetype;
    }
    let finished = false;
    destination.Tagging = "owner=" + user.id;
    await db.updateFileProgress(fileRecord, user.id, filename, encoding, mimetype, key, 'uploading', imageInfo, creatorKey);
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
    const reply: FileUploadResponse = {
      file: await this.getFileInfoForRecord(fileRecord)
    };
    console.log("FileManager.handleUpload sending response", reply);
    response.json(reply);
  }

  private async handleFetch(request: Request, response: Response): Promise<void> {
    console.log("FileManager.handleFetch", request.params.fileId, request.params.fileName);
    const s3Request: GetObjectRequest = {
      Bucket: configuration.get('aws.s3.bucket'),
      Key: request.params.fileId + "/" + request.params.fileName
    };
    const range = request.headers.range || request.headers.Range;
    if (range) {
      console.log("FileManager.handleFetch: range", range);
      s3Request.Range = range.toString();
    }
    let completed = false;
    const s3Fetch = this.s3.getObject(s3Request).on('httpHeaders', (statusCode: number, headers: { [key: string]: string }) => {
      for (const key of Object.keys(headers)) {
        this.transferHeader(response, headers, key);
      }
      response.setHeader("Server", 'Channels');
      response.setHeader("Cache-Control", 'public, max-age=' + 60 * 60 * 24 * 30);
      response.status(statusCode);
    });
    // Since we're piping the content through, if the request stream closes, we need to
    // abort the request to S3 so we don't keep pulling down content we don't want.
    request.on('close', (err: any) => {
      if (!completed) {
        console.log("File.handleFetch:  Aborting file fetch");
        s3Fetch.abort();
      }
    });
    s3Fetch.createReadStream()
      .on('end', () => {
        completed = true;
        console.log("FileManager.handleFetch completed");
      })
      .pipe(response);
  }

  private transferHeader(response: Response, headers: { [key: string]: string }, headerName: string): void {
    const header = headers[headerName];
    if (header && header.length > 0) {
      response.set(headerName, header);
    }
  }

  private async handleDiscardFiles(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<DiscardFilesDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      const fileRecords: FileRecord[] = [];
      if (requestBody.detailsObject.fileIds && requestBody.detailsObject.fileIds.length > 0) {
        for (const fileId of requestBody.detailsObject.fileIds) {
          const fileRecord = await db.findFileById(fileId);
          if (fileRecord) {
            if (fileRecord.ownerId !== user.id) {
              response.status(401).send("You can only discard files you uploaded");
              return;
            }
            fileRecords.push(fileRecord);
          } else {
            response.status(404).send("No such file");
            return;
          }
        }
      }
      console.log("FileManager.discard-files", requestBody.detailsObject);
      for (const fileRecord of fileRecords) {
        if (fileRecord.status === "complete") {
          await db.updateFileStatus(fileRecord, "deleted");
          await this.deleteS3File(fileRecord);
          console.log("FileManager.handleDiscardFiles: file deleted", fileRecord.filename);
        } else if (fileRecord.status === "final") {
          console.error("FileManager.handleDiscardFiles: file discard request for 'final' file ignored", fileRecord);
        } else {
          console.warn("FileManager.handleDiscardFiles: request to discard file in incomplete state.  Ignored.", fileRecord);
        }
      }
      const reply: DiscardFilesResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      console.error("File.handleDiscardFiles: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private deleteS3File(fileRecord: FileRecord): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const deleteObjectRequest: AWS.S3.DeleteObjectRequest = {
        Bucket: fileRecord.s3.bucket,
        Key: fileRecord.s3.key
      };
      this.s3.deleteObject(deleteObjectRequest, (err: AWS.AWSError, data: AWS.S3.DeleteObjectOutput) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async finalizeFiles(user: UserRecord, fileIds: string[]): Promise<void> {
    for (const fileId of fileIds) {
      const fileRecord = await db.findFileById(fileId);
      if (fileRecord) {
        if (fileRecord.ownerId !== user.id) {
          console.error("FileManager.finalizeFiles: Ignoring request to finalize a file that is not owned by this user", user.id, fileRecord);
        } else if (fileRecord.status === "complete") {
          console.log("FileManager.finalizeFiles: setting state of file to 'final'", fileRecord);
          await db.updateFileStatus(fileRecord, "final");
        } else {
          console.error("FileManager.finalizeFiles: Ignoring request to finalize a file that is not currently 'complete'", fileRecord);
        }
      } else {
        console.error("FileManager.finalizeFiles: Ignoring request to finalize a missing file", fileId);
      }
    }
  }

  async getFileInfo(fileId: string): Promise<FileInfo> {
    if (!fileId) {
      return null;
    }
    const fileRecord = await db.findFileById(fileId);
    if (fileRecord) {
      return await this.getFileInfoForRecord(fileRecord);
    } else {
      return null;
    }
  }

  private async getFileInfoForRecord(record: FileRecord): Promise<FileInfo> {
    const result: FileInfo = {
      url: await this.getFileUrl(record),
      fileId: record.id,
      imageInfo: record.imageInfo
    };
    return result;
  }

  async getFileInfoForArray(fileIds: string[]): Promise<FileInfo[]> {
    const promises: Array<Promise<FileInfo>> = [];
    for (const fileId of fileIds) {
      promises.push(this.getFileInfo(fileId));
    }
    return await Promise.all(promises);
  }

  private async getFileUrl(record: FileRecord): Promise<string> {
    const urlInfo = this.fileUrlCache.get(record.id);
    if (urlInfo) {
      return urlInfo.url;
    }
    const result = await this.getS3FileUrl(record);
    this.fileUrlCache.set(record.id, { url: result });
    return result;
  }

  private getS3FileUrl(fileRecord: FileRecord): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const params: any = {
        Bucket: fileRecord.s3.bucket,
        Key: fileRecord.s3.key,
        Expires: FILE_URL_LIFETIME_SECONDS
      };
      this.s3.getSignedUrl('getObject', params, (err: AWS.AWSError, signedUrl: string) => {
        if (err) {
          reject(err);
        } else {
          resolve(signedUrl);
        }
      });
    });
  }

}

const fileManager = new FileManager();

export { fileManager };

export interface FileUrlInfo {
  url: string;
}
