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

var _friendlyTime = function (time) {
  return moment(time).calendar(null, {
    sameDay: 'h:mm a',
    nextDay: '[Tomorrow]',
    nextWeek: 'dddd',
    lastWeek: '[Last] dddd',
    sameElse: 'M/D/YYYY'
  });
};