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
    ga('create', 'UA-52117709-8', 'auto');
    ga('send', 'pageview', '/app');
  }, 1000);
};

var _onLoad = function () {
  _loadAnalytics();
};

if (document.readyState === 'complete') {
  _onLoad();
} else {
  window.addEventListener("load", _onLoad);
}