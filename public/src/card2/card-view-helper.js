class _CardHelper {
  constructor() {
    this._cardObservers = [];
  }

  get intersectionObserver() {
    if (!this._iobserver) {
      const options = {
        root: $app.shell,
        rootMargin: "0px",
        threshold: [0, 1.0]
      };
      this._iobserver = new IntersectionObserver(this._onIntersection.bind(this), options);
    }
    return this._iobserver;
  }

  _onIntersection(entries) {
    entries.forEach(entry => {
      let target = entry.target;
      if (target) {
        for (let i = 0; i < this._cardObservers.length; i++) {
          let h = this._cardObservers[i];
          if (h.card == target) {
            try {
              h.callback(entry);
            } catch (err) {
              console.error(err);
            }
          }
        }
      }
    });
  }

  addIntersectionObserver(card, callback) {
    this.removeIntersectionObserver(card);
    let handler = {
      card: card,
      callback: callback
    };
    this._cardObservers.push(handler);
    this.intersectionObserver.observe(card);
  }

  removeIntersectionObserver(card) {
    let match = -1;
    for (let i = 0; i < this._cardObservers.length; i++) {
      let h = this._cardObservers[i];
      if (h.card == card) {
        match = i;
        break;
      }
    }
    if (match >= 0) {
      this._cardObservers.splice(match, 1);
    }
  }
}

if (!window.$cardHelper) {
  window.$cardHelper = new _CardHelper();
  console.log("card helper loaded");
}