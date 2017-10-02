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
        throw new Error("Cannot install this package because it is not found or doesn't have an available release");
      }
      return await this._installVersion(pkg, versioned);
    } catch (err) {
      console.error("Bower: install failed", err);
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
      bower.commands.info(pkg)
        .on('end', (data: BowerUnversionedPackageInfo) => {
          console.log("Package info: ", data);
          this.infoUnversionedCache.set(pkg, data);
          resolve(data);
        }).on('error', (err: any) => {
          reject(new Error("Error while getting package info: " + err.toString()));
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
      let pkg = requestBody.detailsObject.package;
      console.log("Bower.ensure-component", requestBody.detailsObject);
      // Following code is to help those who might copy a hyperlink to a GitHub project, when bower
      // requires that they point to ".git" for a GitHub project.
      if (pkg.startsWith('https://github.com/') && pkg.lastIndexOf('/') > pkg.lastIndexOf('.')) {
        pkg = pkg + '.git';
      }
      return new Promise<void>((resolve, reject) => {
        void this.install(pkg).then((pkgInfo) => {
          void this.processComponent(pkgInfo, request, response).then(() => {
            console.log("Component loaded", pkgInfo);
            resolve();
          }).catch((err: any) => {
            console.error("Error processing component", pkg, err);
            response.status(err.code ? err.code : 400).send("Unable to load component: " + err.toString());
            resolve();
          });
        }).catch((err) => {
          console.error(err.mesage || err);
          response.status(err.code ? err.code : 503).send("Failure: " + (err.mesage || err));
          resolve();
        });
      });
    } catch (err) {
      console.error("Bower.handleComponent: Failure", err);
      response.status(err.code ? err.code : 500).send(err);
    }
  }

  private async processComponent(pkgInfo: BowerInstallResult, request: Request, response: Response): Promise<void> {
    if (!pkgInfo || !pkgInfo.pkgMeta) {
      throw new Error("Package is invalid or incomplete");
    }
    if (!pkgInfo.pkgMeta.main) {
      throw new Error("Invalid package:  'main' is missing");
    }
    const componentPath = this.shadowComponentsDirectory + '/bower_components/' + pkgInfo.endpoint.name + '/' + 'channels-component.json';
    try {
      if (!fs.existsSync(componentPath)) {
        throw new Error("Invalid component:  channels-component.json is missing");
      }
      const content = fs.readFileSync(componentPath, 'utf-8');
      const descriptor = JSON.parse(content) as ChannelComponentDescriptor;
      if (!descriptor || !descriptor.composerTag || !descriptor.viewerTag) {
        throw new Error("Invalid component descriptor in channel-component.json");
      }
      const componentResponse: ChannelComponentResponse = {
        source: pkgInfo.endpoint.source,
        importHref: this.shadowComponentsPath + '/' + pkgInfo.endpoint.name + '/' + pkgInfo.pkgMeta.main,
        package: pkgInfo,
        channelComponent: descriptor
      };
      response.json(componentResponse);
    } catch (err) {
      throw err;
    }
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
