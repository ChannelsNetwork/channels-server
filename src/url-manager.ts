import { configuration } from "./configuration";
import * as url from 'url';

export class UrlManager {
  private version: number;
  constructor(version: number) {
    this.version = version;
  }

  getAbsoluteUrl(relativeUrl: string): string {
    if (!relativeUrl.startsWith('/')) {
      relativeUrl += '/';
    }
    return configuration.get('baseClientUri') + relativeUrl;
  }

  getPublicBaseUrl(absolute = false): string {
    const baseUrl = '/v' + this.version;
    if (absolute) {
      return configuration.get('baseClientUri') + baseUrl;
    }
    return baseUrl;
  }

  getDynamicBaseUrl(absolute = false): string {
    if (absolute) {
      return configuration.get('baseClientUri') + '/d';
    } else {
      return '/d';
    }
  }

  getBowerComponentBaseUrl(absolute = false): string {
    const baseUrl = '/v' + this.version + "/bower_components/";
    if (absolute) {
      return configuration.get('baseClientUri') + baseUrl;
    }
    return baseUrl;
  }

  getStaticBaseUrl(absolute = false): string {
    if (absolute) {
      return configuration.get('baseClientUri') + '/s';
    } else {
      return '/s';
    }
  }

  getStaticUrl(relativeUrl: string, absolute = false): string {
    if (!relativeUrl.startsWith('/')) {
      relativeUrl = '/' + relativeUrl;
    }
    if (absolute) {
      return configuration.get('baseClientUri') + '/s' + relativeUrl;
    } else {
      return '/s' + relativeUrl;
    }
  }

  getDynamicUrl(relativeUrl: string, absolute = false): string {
    if (!relativeUrl.startsWith('/')) {
      relativeUrl = '/' + relativeUrl;
    }
    if (absolute) {
      return configuration.get('baseClientUri') + '/d' + relativeUrl;
    } else {
      return '/d' + relativeUrl;
    }
  }

  getBowerComponentUrl(relativeUrl: string): string {
    return url.resolve(this.getBowerComponentBaseUrl(), relativeUrl);
  }

  getPublicUrl(relativeUrl: string, absolute = false): string {
    if (!relativeUrl.startsWith('/')) {
      relativeUrl = '/' + relativeUrl;
    }
    return this.getPublicBaseUrl(absolute) + relativeUrl;
  }

  getVersionedUrl(relativeUrl: string, absolute = false): string {
    if (!relativeUrl.startsWith('/')) {
      relativeUrl = '/' + relativeUrl;
    }
    if (absolute) {
      return configuration.get('baseClientUri') + '/v' + this.version + relativeUrl;
    } else {
      return '/d' + relativeUrl;
    }
  }

  getSocketUrl(relativeUrl: string): string {
    return configuration.get('baseSocketUri') + '/d/' + relativeUrl;
  }
}
