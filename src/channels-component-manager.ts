import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import { db } from "./db";
import { Utils } from "./utils";
import { configuration } from "./configuration";
import * as LRU from 'lru-cache';
import * as fs from 'fs';
import * as inquirer from 'inquirer';
import { Initializable } from "./interfaces/initializable";
import { UrlManager } from "./url-manager";
const remove = require('remove');
import * as path from "path";
import { RestServer } from "./interfaces/rest-server";
import { ChannelComponentDescriptor, ChannelComponentResponse, EnsureChannelComponentDetails, RestRequest } from "./interfaces/rest-services";
import { RestHelper } from "./rest-helper";
import * as mkdirp from 'mkdirp';
import { ErrorWithStatusCode } from "./interfaces/error-with-code";
import { SERVER_VERSION } from "./server-version";
import * as url from 'url';

const bower = require('bower');

export class ChannelsComponentManager implements RestServer {
  private shadowComponentsDirectory: string;
  private shadowComponentsPath: string;
  private infoVersionedCache = LRU<string, BowerPackageMeta>({ max: 1000, maxAge: 1000 * 60 * 5 });
  private infoUnversionedCache = LRU<string, BowerUnversionedPackageInfo>({ max: 1000, maxAge: 1000 * 60 * 5 });
  private installedPackageCache = LRU<string, BowerInstallResult>({ max: 1000, maxAge: 1000 * 60 * 60 });

  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    this.shadowComponentsDirectory = configuration.get('sharedFilesystemPath', path.join(__dirname, '../shadow-public'));
    mkdirp.sync(this.shadowComponentsDirectory);
    this.shadowComponentsPath = urlManager.getPublicUrl('bower_components');
    app.use(urlManager.getPublicBaseUrl(), express.static(this.shadowComponentsDirectory, { maxAge: 1000 * 60 * 60 * 24 }));
    app.post(urlManager.getDynamicUrl('/ensure-component'), (request: Request, response: Response) => {
      void this.handleComponent(request, response);
    });
  }

  private async install(pkg: string): Promise<BowerInstallResult> {
    // Following code is to help those who might copy a hyperlink to a GitHub project, when bower
    // requires that they point to ".git" for a GitHub project.
    if (pkg.startsWith('https://github.com/') && pkg.lastIndexOf('/') > pkg.lastIndexOf('.')) {
      pkg = pkg + '.git';
    }
    await this.lockBower("Installing " + pkg);
    try {
      await this.ensureInit();
      let versioned: BowerPackageMeta;
      if (pkg.indexOf('#') < 0) {
        const unversioned = await this._infoUnversioned(pkg);
        versioned = unversioned ? unversioned.latest : null;
      } else {
        versioned = await this._infoVersioned(pkg);
      }
      if (!versioned || !versioned.name || !versioned.version || !/^\d+\.\d+\.\d+$/.test(versioned.version)) {
        throw new ErrorWithStatusCode(404, "Cannot install this package because it is not found or doesn't have an available release");
      }
      return await this._installVersion(pkg, versioned);
    } catch (err) {
      console.error("Bower: install failed", err);
      throw (err);
    } finally {
      await this.unlockBower();
    }
  }

  async updateAll(): Promise<void> {
    console.log("Bower: updating all packages ...");
    await this.lockBower("Cleaning...");
    try {
      await this._updateAll();
      console.log("Bower: update complete");
    } catch (err) {
      console.error("Bower: updated failed", err);
    } finally {
      await this.unlockBower();
    }
  }

  async clean(): Promise<void> {
    console.log("Bower: clearing out any existing contents...");
    await this.lockBower("Cleaning...");
    try {
      await this._clean();
      console.log("Bower: cleaning complete");
    } catch (err) {
      console.error("Bower: install failed", err);
    } finally {
      await this.unlockBower();
    }
  }

  private async _clean(): Promise<void> {
    this.infoVersionedCache.reset();
    this.infoUnversionedCache.reset();
    this.installedPackageCache.reset();
    return new Promise<void>((resolve, reject) => {
      remove(this.shadowComponentsDirectory + "/bower_components", (err: any) => {
        if (err) {
          reject(err);
        } else {
          remove(this.shadowComponentsDirectory + "/bower.json", (err2: any) => {
            if (err) {
              reject(err2);
            } else {
              resolve();
            }
          });
        }
      });
    });
  }

  private async lockBower(description: string): Promise<void> {
    let count = 0;
    const serverId = configuration.get('serverId');
    let bowerManagement = await db.findBowerManagement('main');
    while (true) {
      if (count++ > 100) {
        throw new Error("Timeout waiting for bower lock to become available");
      }
      if (bowerManagement && bowerManagement.status === 'busy') {
        if (Date.now() - bowerManagement.timestamp > 1000 * 60) {
          console.warn("BowerHelper: encountered stale bower lock.  Forcing.", description);
          if (await db.updateBowerManagement('main', serverId, 'busy', Date.now(), bowerManagement ? bowerManagement.status : null, bowerManagement ? bowerManagement.timestamp : null)) {
            break;
          }
          console.log("BowerHelper: Someone jumped ahead.  Waiting again...", description);
        } else {
          console.warn("BowerHelper: Busy ... waiting ...", description);
        }
        await Utils.sleep(1000);
      } else {
        if (await db.updateBowerManagement('main', serverId, 'busy', Date.now(), bowerManagement ? bowerManagement.status : null, bowerManagement ? bowerManagement.timestamp : null)) {
          break;
        } else {
          console.warn("BowerHelper: collision trying to get lock. Waiting then trying again", description);
          await Utils.sleep(1000);
        }
      }
      bowerManagement = await db.findBowerManagement('main');
    }
    console.log("BowerHelper: Lock acquired", description);
  }

  private async unlockBower(): Promise<void> {
    await db.updateBowerManagement('main', configuration.get('serverId'), 'available', Date.now());
    console.log("BowerHelper: Lock released");
  }

  private async ensureInit(): Promise<void> {
    if (fs.existsSync(this.shadowComponentsDirectory + '/bower.json')) {
      return;
    }
    console.log("Bower: initializing new bower.json...");
    return new Promise<void>((resolve, reject) => {
      fs.existsSync(this.shadowComponentsDirectory + "/data");  // This is to deal with a problem where automount EFS may have timed out and needs to be woken up
      bower.commands
        .init({ interactive: true, cwd: this.shadowComponentsDirectory })
        .on('prompt', (prompts: inquirer.Question[], callback: (answers: inquirer.Answers) => void) => {
          // Using all default responses
          const answers: inquirer.Answers = {};
          for (const prompt of prompts) {
            answers[prompt.name] = prompt.default ? prompt.default : '';
          }
          callback(answers);
        })
        .on('end', (result: any) => {
          console.log("Bower:  completed bower init", result);
          resolve();
        })
        .on('error', (err: any) => {
          console.error("Failure trying to bower init", err);
          resolve();
        })
        .on('log', (log: any) => {
          console.log("Bower logging while init:", log);
        });
    });
  }

  private async _updateAll(): Promise<void> {
    console.log("Bower: updating all existing...");
    return new Promise<void>((resolve, reject) => {
      fs.existsSync(this.shadowComponentsDirectory + "/data");  // This is to deal with a problem where automount EFS may have timed out and needs to be woken up
      bower.commands
        .update([], { json: true, production: true, save: true, "force-latest": true }, { cwd: this.shadowComponentsDirectory })
        .on('end', (installed: any) => {
          console.error("Bower: Update all completed");
          resolve();
        })
        .on('error', (err: any) => {
          console.error("Bower: Failure updating all");
          resolve();
        })
        .on('log', (log: any) => {
          console.log("Bower: Logging while updating all:", log);
        });
    });
  }

  private async _infoUnversioned(pkg: string): Promise<BowerUnversionedPackageInfo> {
    if (pkg.indexOf('#') >= 0) {
      throw new Error("Invalid unversioned package name");
    }
    const cached = this.infoUnversionedCache.get(pkg);
    if (cached) {
      return cached;
    }
    return new Promise<BowerUnversionedPackageInfo>((resolve, reject) => {
      fs.existsSync(this.shadowComponentsDirectory + "/data");  // This is to deal with a problem where automount EFS may have timed out and needs to be woken up
      bower.commands.info(pkg)
        .on('end', (data: BowerUnversionedPackageInfo) => {
          console.log("Package info: ", data);
          this.infoUnversionedCache.set(pkg, data);
          resolve(data);
        }).on('error', (err: any) => {
          reject(new ErrorWithStatusCode(404, "This does not appear to be a valid package location.  It must be accessible using 'bower install'."));
        });
    });
  }

  private async _infoVersioned(pkg: string): Promise<BowerPackageMeta> {
    if (pkg.indexOf('#') < 0) {
      throw new Error("Invalid versioned package name");
    }
    const cached = this.infoVersionedCache.get(pkg);
    if (cached) {
      return cached;
    }
    return new Promise<BowerPackageMeta>((resolve, reject) => {
      fs.existsSync(this.shadowComponentsDirectory + "/data");  // This is to deal with a problem where automount EFS may have timed out and needs to be woken up
      bower.commands.info(pkg)
        .on('end', (data: BowerPackageMeta) => {
          console.log("Package info: ", data);
          this.infoVersionedCache.set(pkg, data);
          resolve(data);
        }).on('error', (err: any) => {
          reject(new Error("Error while getting package info: " + err.toString()));
        });
    });
  }

  private async _installVersion(nameToInstall: string, pkg: BowerPackageMeta): Promise<BowerInstallResult> {
    nameToInstall = nameToInstall.split('#')[0] + "#" + pkg.version;
    const fullPkgName = pkg.name + "_" + pkg.version;
    const cached = this.installedPackageCache.get(fullPkgName);
    if (cached) {
      return cached;
    }
    return new Promise<BowerInstallResult>((resolve, reject) => {
      console.log("Bower.install " + fullPkgName + "...");
      fs.existsSync(this.shadowComponentsDirectory + "/data");  // This is to deal with a problem where automount EFS may have timed out and needs to be woken up
      bower.commands
        .install([fullPkgName + "=" + nameToInstall], { "force-latest": true, save: true, production: true, json: true }, { cwd: this.shadowComponentsDirectory })
        .on('end', (installed: { [name: string]: BowerInstallPackageResult }) => {
          let result: BowerInstallResult;
          if (installed && installed[fullPkgName]) {
            result = installed[fullPkgName];
            console.log("Bower._installVersion: completed", result);
          } else {
            // It must have already been installed, so the pkg information is all we need
            result = {
              endpoint: {
                name: fullPkgName,
                source: nameToInstall,
                target: pkg.version
              },
              pkgMeta: pkg
            };
            console.log("Bower._installVersion: already installed", result);
          }
          this.installedPackageCache.set(fullPkgName, result);
          resolve(result);
        })
        .on('error', (err: any) => {
          reject(new Error("Error while installing component: " + err.toString()));
        })
        .on('log', (log: any) => {
          console.log("Bower logging:", log);
        });
    });
  }

  async ensureComponent(pkg: string): Promise<ChannelComponentResponse> {
    console.log("ComponentManager.ensure-component", pkg);
    if (!pkg) {
      throw new ErrorWithStatusCode(400, "This is not a valid package reference for the card type");
    }
    const pkgInfo = await this.install(pkg);
    return await this.processComponent(pkg, pkgInfo);
  }

  private async handleComponent(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<EnsureChannelComponentDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      if (!requestBody.detailsObject.package) {
        response.status(400).send("Invalid request:  missing package");
        return;
      }
      const componentResponse = await this.ensureComponent(requestBody.detailsObject.package);
      response.json(componentResponse);
    } catch (err) {
      console.error("Bower.handleComponent: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async processComponent(pkg: string, pkgInfo: BowerInstallResult): Promise<ChannelComponentResponse> {
    if (!pkgInfo || !pkgInfo.pkgMeta) {
      throw new ErrorWithStatusCode(400, "This is not a valid package or is incomplete");
    }
    if (!pkgInfo.pkgMeta.main) {
      throw new ErrorWithStatusCode(400, "This package is invalid:  'main' is missing from bower.json.");
    }
    const componentPath = this.shadowComponentsDirectory + '/bower_components/' + pkgInfo.endpoint.name + '/' + 'channels-component.json';
    if (!fs.existsSync(componentPath)) {
      throw new ErrorWithStatusCode(400, "This package does not appear to contain a Channels card definition.  Missing channels-component.json.");
    }
    const content = fs.readFileSync(componentPath, 'utf-8');
    const descriptor = JSON.parse(content) as ChannelComponentDescriptor;
    if (!descriptor || !descriptor.composerTag || !descriptor.viewerTag) {
      throw new ErrorWithStatusCode(400, "The channel-component.json file in this package is invalid.");
    }
    if (descriptor.developerFraction && Number(descriptor.developerFraction) < 0 || Number(descriptor.developerFraction) > 0.99) {
      throw new ErrorWithStatusCode(400, "The channel-component.json file in this package has an invalid value for developerFraction.  It must be between 0 and 1.");
    }
    const componentResponse: ChannelComponentResponse = {
      serverVersion: SERVER_VERSION,
      source: pkgInfo.endpoint.source,
      importHref: this.shadowComponentsPath + '/' + pkgInfo.endpoint.name + '/' + pkgInfo.pkgMeta.main,
      package: pkgInfo,
      channelComponent: descriptor,
      iconUrl: url.resolve(this.shadowComponentsPath + '/' + pkgInfo.endpoint.name + '/', descriptor.iconUrl)
    };
    console.log("ComponentManager.processComponent: upserting bower package", pkg);
    await db.upsertBowerPackage(pkg, pkgInfo, descriptor);
    return componentResponse;
  }

  async getPackageRootUrl(packageName: string): Promise<string> {
    let record = await db.findBowerPackage(packageName);
    if (!record) {
      await this.ensureComponent(packageName);
      console.warn("ComponentManager.getPackageRootUrl:  Fixing up missing package", packageName);
      record = await db.findBowerPackage(packageName);
      if (!record) {
        return null;
      }
    }
    const pkg = JSON.parse(record.package) as BowerInstallResult;
    return this.shadowComponentsPath + '/' + pkg.endpoint.name + '/';
  }
}

const channelsComponentManager = new ChannelsComponentManager();

export { channelsComponentManager };

export interface BowerUnversionedPackageInfo {
  name: string;
  versions: string[];
  latest: BowerPackageMeta;
}

export interface BowerInstallResult {
  endpoint: {
    name: string;
    source: string;
    target: string;
  };
  pkgMeta: BowerPackageMeta;
}
interface BowerInstallPackageResult extends BowerInstallResult {
  canonicalDir: string;
  dependencies: any;
  nrDependants: number;
}

export interface BowerPackageMeta {
  name: string;
  homepage: string;
  version: string;
  main?: string;
  _release: string;
  _resolution: {
    type: string;
    tag: string;
    commit: string;
  };
  _source: string;
  _target: string;
}
