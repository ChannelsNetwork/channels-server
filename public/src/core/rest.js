class RestService {
  post(url, object) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.withCredentials = true;
      request.open("POST", url);
      request.setRequestHeader("Content-Type", 'application/json');
      request.onload = () => {
        const status = request.status;
        if (status === 0 || status >= 400) {
          if (request.responseText) {
            this.onError(reject, status, request.responseText);
          } else {
            this.onError(reject, status, 'Request failed with code: ' + status);
          }
        } else {
          if (request.responseText) {
            resolve(JSON.parse(request.responseText));
          } else {
            resolve(null);
          }
        }
      };
      request.onerror = (err) => {
        this.onError(reject, 0, "There was a network error: " + err);
      };
      if (object) {
        request.send(JSON.stringify(object));
      } else {
        request.send();
      }
    });
  }

  onError(reject, code, message) {
    const e = new Error(message);
    e.code = code;
    reject(e);
  }
}

class RestUtils {
  static now() {
    return (new Date()).getTime();
  }

  static registerUserDetails(address, publicKey, inviteCode) {
    return {
      publicKey: publicKey,
      inviteCode: inviteCode,
      address: address,
      timestamp: RestUtils.now()
    };
  }

  static registerDeviceDetails(address, deviceToken) {
    return {
      token: deviceToken,
      type: "web",
      address: address,
      timestamp: RestUtils.now()
    };
  }

  static updateIdentityDetails(address, name, handle, location, imageUrl, emailAddress) {
    return {
      name: name,
      handle: handle,
      location: location,
      imageUrl: imageUrl,
      emailAddress: emailAddress,
      address: address,
      timestamp: RestUtils.now()
    };
  }

  static getUserIdentityDetails(address) {
    return {
      address: address,
      timestamp: RestUtils.now()
    };
  }

  static checkHandleDetails(address, handle) {
    return {
      handle: handle,
      address: address,
      timestamp: RestUtils.now()
    };
  }

  static EnsureChannelComponentDetails(address, packageName) {
    return {
      package: packageName,
      address: address,
      timestamp: RestUtils.now()
    };
  }
}