import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response, NextFunction } from 'express';
import * as net from 'net';
import { configuration } from "./configuration";
import { RestServer } from './interfaces/rest-server';
import { db } from "./db";
import { UserRecord, FileRecord, ImageInfo } from "./interfaces/db-records";
import { UrlManager } from "./url-manager";
import * as Busboy from 'busboy';
import * as s3Stream from "s3-upload-stream";
import * as uuid from "uuid";
import { KeyUtils } from "./key-utils";
import * as url from 'url';
import * as streamMeter from "stream-meter";
import { DiscardFilesDetails, DiscardFilesResponse, RestRequest, FileInfo } from "./interfaces/rest-services";
import { SERVER_VERSION } from "./server-version";
import { RestHelper } from "./rest-helper";
import * as AWS from 'aws-sdk';
import { userManager } from "./user-manager";
import * as LRU from 'lru-cache';
import * as Jimp from 'jimp';
const imageProbe = require('probe-image-size');
import path = require('path');
import { errorManager } from "./error-manager";
import { ErrorWithStatusCode } from "./interfaces/error-with-code";

const MAX_CLOCK_SKEW = 1000 * 60 * 15;
export class FileManager implements RestServer {
  private app: express.Application;
  private urlManager: UrlManager;
  private s3StreamUploader: s3Stream.S3StreamUploader;
  private s3: AWS.S3;
  private oldFileUrlPrefix: string;
  private bypassUrlPrefix: string;
  private fileCache = LRU<string, FileRecord>({ max: 10000, maxAge: 1000 * 60 * 15 });

  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    if (configuration.get('aws.s3.enabled')) {
      this.s3 = new AWS.S3({
        accessKeyId: configuration.get('aws.accessKeyId'),
        secretAccessKey: configuration.get('aws.secretAccessKey')
      });
      this.s3StreamUploader = s3Stream(this.s3);
    }
    this.urlManager = urlManager;
    const baseUrl = configuration.get('baseClientUri');
    if (baseUrl.indexOf('https://') >= 0) {
      this.oldFileUrlPrefix = baseUrl + "/f/";
      this.bypassUrlPrefix = baseUrl + "/";
    }
    this.app = app;
    this.registerHandlers();
  }

  async getFile(fileId: string, force: boolean): Promise<FileRecord> {
    let result = this.fileCache.get(fileId);
    if (result && !force) {
      return result;
    }
    result = await db.findFileById(fileId);
    if (result) {
      this.fileCache.set(fileId, result);
    }
    return result;
  }

  async finalizeFiles(user: UserRecord, fileIds: string[]): Promise<void> {
    for (const fileId of fileIds) {
      const fileRecord = await this.getFile(fileId, true);
      if (fileRecord) {
        if (fileRecord.ownerId !== user.id) {
          errorManager.error("FileManager.finalizeFiles: Ignoring request to finalize a file that is not owned by this user", null, user.id, fileRecord);
        } else if (fileRecord.status === "complete") {
          console.log("FileManager.finalizeFiles: setting state of file to 'final'", fileRecord);
          await db.updateFileStatus(fileRecord, "final");
        } else {
          errorManager.error("FileManager.finalizeFiles: Ignoring request to finalize a file that is not currently 'complete'", null, fileRecord);
        }
      } else {
        errorManager.error("FileManager.finalizeFiles: Ignoring request to finalize a missing file", null, fileId);
      }
    }
  }

  private registerHandlers(): void {
    if (this.s3StreamUploader) {
      this.app.post(this.urlManager.getDynamicUrl('upload'), (request: Request, response: Response) => {
        void this.handleUpload(request, response);
      });
      this.app.get('/f/:fileId/:fileName', (request: Request, response: Response) => {
        void this.handleFetch(request, response);
      });
      this.app.get('/:fileId/:fileName', (request: Request, response: Response, next: NextFunction) => {
        void this.handleBypassFetch(request, response, next);
      });
      this.app.get('/img/:imgFileId', (request: Request, response: Response) => {
        void this.handleFetchImageFile(request, response);
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
    const busboy = new Busboy({ headers: request.headers });
    busboy.on('file', (fieldname: string, file: NodeJS.ReadableStream, filename: string, encoding: string, mimetype: string) => {
      const fName = requestedFileName || filename || "unnamed";
      console.log("FileManager.handleUpload starting file", fName);
      void this.handleUploadStart(file, fName, encoding, mimetype, fileRecord, ownerAddress, signatureTimestamp, signature, response);
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
      const user = await userManager.getUserByAddress(ownerAddress);
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
      errorManager.error("File.handleUploadStart: Failure", null, err);
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
    await db.updateFileProgress(fileRecord, user.id, filename, encoding, mimetype, key, 'uploading');
    const upload = this.s3StreamUploader.upload(destination);
    upload.on('error', (err) => {
      errorManager.warning("FileManager.uploadS3: upload failed", null, err);
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
    const fileUrl = this.urlManager.getAbsoluteUrl('/' + key);
    let imageInfo: ImageInfo;
    if (fileRecord.mimetype && fileRecord.mimetype.split('/')[0] === 'image') {
      imageInfo = await this.fetchImageInfo(fileUrl);
    }
    await db.updateFileCompletion(fileRecord, 'complete', meter.bytes, fileUrl, imageInfo);
    await db.incrementUserStorage(user, meter.bytes);
    console.log("FileManager.uploadS3: upload completed", fileRecord.id);
    const reply = {
      fileId: fileRecord.id,
      url: fileUrl
    };
    console.log("FileManager.handleUpload sending response", reply);
    response.json(reply);
  }

  private async fetchImageInfo(imageUrl: string): Promise<ImageInfo> {
    try {
      const probeResult = await imageProbe(imageUrl);
      console.log("File.fetchImageInfo", imageUrl, probeResult);
      const imageInfo: ImageInfo = {
        width: probeResult.width,
        height: probeResult.height
      };
      return imageInfo.width && imageInfo.height ? imageInfo : null;
    } catch (err) {
      console.warn("File.fetchImageInfo: failure fetching image info", err);
      return null;
    }
  }

  private async handleFetch(request: Request, response: Response): Promise<void> {
    console.log("FileManager.handleFetch", request.params.fileId, request.params.fileName);
    await this.handleFetch2(request, response);
  }

  private async handleFetch2(request: Request, response: Response): Promise<void> {
    const s3Request: AWS.S3.GetObjectRequest = {
      Bucket: configuration.get('aws.s3.bucket'),
      Key: request.params.fileId + "/" + request.params.fileName
    };
    const range = request.headers.range || request.headers.Range;
    if (range) {
      console.log("FileManager.handleFetch: range", range);
      s3Request.Range = range.toString();
    }
    let completed = false;
    const s3Fetch = this.s3.getObject(s3Request)
      .on('httpHeaders', (statusCode: number, headers: { [key: string]: string }) => {
        for (const key of Object.keys(headers)) {
          this.transferHeader(response, headers, key);
        }
        response.setHeader("Server", 'Channels');
        response.setHeader("Cache-Control", 'public, max-age=' + 60 * 60 * 24 * 30);
        response.status(statusCode);
      })
      .on('error', (err) => {
        console.warn("File.handleFetch2 Error on S3 fetch", err);
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
      .on('error', (err) => {
        console.warn("FileManager.handleFetch2 readStream failed", err);
      })
      .pipe(response);
  }
  private async handleBypassFetch(request: Request, response: Response, next: NextFunction): Promise<void> {
    // This is to handle development machine cases where we are using bypass fileURLs (instead of /f/...)
    if (!/^[a-z0-9]{8}\-[a-z0-9]{4}\-[a-z0-9]{4}\-[a-z0-9]{4}\-[a-z0-9]{12}$/i.test(request.params.fileId)) {
      next();
      return;
    }
    console.log("FileManager.handleBypassFetch", request.params.fileId, request.params.fileName);
    await this.handleFetch2(request, response);
  }

  private async handleFetchImageFile(request: Request, response: Response): Promise<void> {
    console.log("FileManager.handleFetchImageFile", request.params.imgFileId, request.params.fileName);
    const fileRecord = await db.findFileById(request.params.imgFileId);
    if (!fileRecord) {
      response.status(404).send("No such file");
      return;
    }
    const width = Number(request.query.w || "0");
    const height = Number(request.query.h || "0");
    const diameter = Number(request.query.d || "0");
    if (!width && !height && !diameter) {
      response.status(400).send("You must send w and/or h params or d param");
      return;
    }
    console.log("File.handleFetchImageFile: Fetching image file for size adaptation", fileRecord.id, width, height, diameter);
    try {
      const image = await Jimp.read(fileRecord.url);
      if (!image) {
        throw new ErrorWithStatusCode(500, "Unable to load file as image");
      }
      image.background(0xffffffff);
      const mime = Jimp.MIME_JPEG;
      if (diameter > 0) {
        const mask = await Jimp.read(path.join(__dirname, '../circularMask.png'));
        image.cover(512, 512);
        image.mask(mask, 0, 0);
        image.resize(diameter, diameter);
        // mime = Jimp.MIME_PNG;
      } else if (width === 0 || height === 0) {
        image.resize(width ? width : Jimp.AUTO, height ? height : Jimp.AUTO);
      } else {
        image.cover(width, height);
      }
      const buf = await this.getImageBuffer(image, mime);
      response.contentType(mime);
      response.setHeader("Cache-Control", 'public, max-age=' + 60 * 60 * 24 * 7);
      response.status(200);
      response.end(buf, 'binary');
    } catch (err) {
      errorManager.error("File.handleFetchImageFile: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async getImageBuffer(image: Jimp, mime: string): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      image.getBuffer(mime, (err: any, buf: Buffer) => {
        if (err) {
          reject(err);
        } else {
          resolve(buf);
        }
      });
    });
  }

  getCoverImageUrl(fileId: string, width: number, height: number): string {
    return this.urlManager.getAbsoluteUrl('/img/' + fileId + "?" + (width ? "w=" + width + "&" : "") + (height ? "h=" + height : ""));
  }

  getCircularImageUrl(fileId: string, diameter: number): string {
    return this.urlManager.getAbsoluteUrl('/img/' + fileId + "?d=" + diameter);
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
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      const fileRecords: FileRecord[] = [];
      if (requestBody.detailsObject.fileIds && requestBody.detailsObject.fileIds.length > 0) {
        for (const fileId of requestBody.detailsObject.fileIds) {
          const fileRecord = await this.getFile(fileId, true);
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
          errorManager.error("FileManager.handleDiscardFiles: file discard request for 'final' file ignored", null, fileRecord);
        } else {
          errorManager.warning("FileManager.handleDiscardFiles: request to discard file in incomplete state.  Ignored.", request, fileRecord);
        }
      }
      const reply: DiscardFilesResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("File.handleDiscardFiles: Failure", request, err);
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

  rewriteFileUrls(value: string): string {
    if (!value || !this.oldFileUrlPrefix) {
      return value;
    }
    value = value.split(this.oldFileUrlPrefix).join(this.bypassUrlPrefix);
    return value;
  }

  rewriteObjectFileUrls(value: any): any {
    if (!value) {
      return value;
    }
    if (typeof value !== 'object') {
      throw new Error("fileManager.rewriteObjectFileUrls: Invalid type");
    }
    const result = JSON.parse(JSON.stringify(value));
    if (Array.isArray(result)) {
      for (let i = 0; i < result.length; i++) {
        if (typeof result[i] === 'string') {
          result[i] = this.rewriteFileUrls(result[i]);
        } else if (typeof result[i] === 'object') {
          result[i] = this.rewriteObjectFileUrls(result[i]);
        }
      }
    } else {
      for (const key of Object.keys(result)) {
        if (typeof result[key] === 'string') {
          result[key] = this.rewriteFileUrls(result[key]);
        } else if (typeof result[key] === 'object') {
          result[key] = this.rewriteObjectFileUrls(result[key]);
        }
      }
    }
    return result;
  }

  async getFileInfo(fileId: string): Promise<FileInfo> {
    if (!fileId) {
      return null;
    }
    const record = await this.getFile(fileId, false);
    if (!record || (record.status !== 'complete' && record.status !== 'final')) {
      return null;
    }
    const result: FileInfo = {
      id: record.id,
      url: this.getFileUrl(record),
      imageInfo: record.imageInfo
    };
    return result;
  }

  getFileUrl(record: FileRecord): string {
    return this.urlManager.getAbsoluteUrl('/' + record.id + '/' + record.filename);
  }

  async getFileUrlFromFileId(fileId: string): Promise<string> {
    const info = await this.getFileInfo(fileId);
    if (!info) {
      return null;
    }
    return info.url;
  }
}

const fileManager = new FileManager();

export { fileManager };
