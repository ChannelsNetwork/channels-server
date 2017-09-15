import { configuration } from "./configuration";
import * as url from 'url';

export class UrlManager {
  private version: number;
  constructor(version: number) {
    this.version = version;
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

  getPublicUrl(relativeUrl: string): string {
    return url.resolve(this.getPublicBaseUrl(true), relativeUrl);
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
