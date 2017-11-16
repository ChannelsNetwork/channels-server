if (!HTMLCanvasElement.prototype.toBlob) {
  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
    value: function (callback, type, quality) {
      var canvas = this;
      setTimeout(function () {
        var binStr = atob(canvas.toDataURL(type, quality).split(',')[1]),
          len = binStr.length,
          arr = new Uint8Array(len);
        for (var i = 0; i < len; i++) {
          arr[i] = binStr.charCodeAt(i);
        }
        callback(new Blob([arr], { type: type || 'image/png' }));
      });
    }
  });
}

var _debounce = function (func, wait, immediate) {
  var timeout;
  return function () {
    var context = this, args = arguments;
    var later = () => {
      timeout = null;
      if (!immediate) {
        func.apply(context, args);
      }
    };
    var callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) {
      func.apply(context, args);
    }
  }
};

var _friendlyTime = function (input) {
  return input;
};

var _loadAnalytics = function () {
  setTimeout(() => {
    (function (i, s, o, g, r, a, m) {
      i['GoogleAnalyticsObject'] = r; i[r] = i[r] || function () {
        (i[r].q = i[r].q || []).push(arguments)
      }, i[r].l = 1 * new Date(); a = s.createElement(o),
        m = s.getElementsByTagName(o)[0]; a.async = 1; a.src = g; m.parentNode.insertBefore(a, m)
    })(window, document, 'script', 'https://www.google-analytics.com/analytics.js', 'ga');
    ga('create', window.googleAnalyticsId || "UA-52117709-8", 'auto');
    ga('send', 'pageview', '/app');
  }, 1000);
};

var _getBrowserInfo = function () {
  if (window._browserInfo) {
    return window._browserInfo;
  }
  try {
    let objappVersion = navigator.appVersion;
    let objAgent = navigator.userAgent;
    let objbrowserName = navigator.appName;
    let objfullVersion = '' + parseFloat(navigator.appVersion);
    let objBrMajorVersion = parseInt(navigator.appVersion, 10);
    let objOffsetName, objOffsetVersion, ix;
    if ((objOffsetVersion = objAgent.indexOf("Chrome")) != -1) { objbrowserName = "Chrome"; objfullVersion = objAgent.substring(objOffsetVersion + 7); }
    else if ((objOffsetVersion = objAgent.indexOf("Edge")) != -1) { objbrowserName = "Edge"; objfullVersion = objAgent.substring(objOffsetVersion + 5); }
    else if ((objOffsetVersion = objAgent.indexOf("MSIE")) != -1) { objbrowserName = "IE"; objfullVersion = objAgent.substring(objOffsetVersion + 5); }
    else if ((objOffsetVersion = objAgent.indexOf("Firefox")) != -1) { objbrowserName = "Firefox"; objfullVersion = objAgent.substring(objOffsetVersion + 8); }
    else if ((objOffsetVersion = objAgent.indexOf("Safari")) != -1) { objbrowserName = "Safari"; objfullVersion = objAgent.substring(objOffsetVersion + 7); if ((objOffsetVersion = objAgent.indexOf("Version")) != -1) objfullVersion = objAgent.substring(objOffsetVersion + 8); }
    else if ((objOffsetName = objAgent.lastIndexOf(' ') + 1) < (objOffsetVersion = objAgent.lastIndexOf('/'))) { objbrowserName = objAgent.substring(objOffsetName, objOffsetVersion); objfullVersion = objAgent.substring(objOffsetVersion + 1); if (objbrowserName.toLowerCase() == objbrowserName.toUpperCase()) { objbrowserName = navigator.appName; } }

    if ((ix = objfullVersion.indexOf(";")) != -1)
      objfullVersion = objfullVersion.substring(0, ix);
    if ((ix = objfullVersion.indexOf(" ")) != -1)
      objfullVersion = objfullVersion.substring(0, ix);

    objBrMajorVersion = parseInt('' + objfullVersion, 10);
    if (isNaN(objBrMajorVersion)) {
      objfullVersion = '' + parseFloat(navigator.appVersion);
      objBrMajorVersion = parseInt(navigator.appVersion, 10);
    }

    window._browserInfo = {
      browser: objbrowserName,
      version: objBrMajorVersion
    };
    return window._browserInfo;
  } catch (ex) {
    console.error("Failed to detect browser version", ex);
    return null;
  }
};

var _hideInvalidVersionDialog = function () {
  let versionPanelNode = document.getElementById("invalidVersionPanel");
  if (versionPanelNode) {
    versionPanelNode.style.display = "none";
  }
};

var _onLoad = function () {
  _loadAnalytics();

  // Check browser compatibility
  let binfo = _getBrowserInfo();
  let showVersionPanel = false;
  if (binfo) {
    switch (binfo.browser) {
      case "Firefox":
        showVersionPanel = binfo.version < 55;
        break;
      case "Chrome":
        showVersionPanel = binfo.version < 51;
        break;
      case "Safari":
        showVersionPanel = binfo.version < 10;
        break;
      case "Edge":
        showVersionPanel = binfo.version < 15;
        break;
      default:
        showVersionPanel = true;
        break;
    }
  }
  if (showVersionPanel) {
    let versionPanelNode = document.getElementById("invalidVersionPanel");
    if (versionPanelNode) {
      versionPanelNode.style.display = "block";
    }
  }
};

if (document.readyState === 'complete') {
  _onLoad();
} else {
  window.addEventListener("load", _onLoad);
}