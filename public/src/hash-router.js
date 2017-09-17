class HashRouter extends Polymer.Element {
  constructor() {
    super();
    this._attached = false;
  }

  static get is() { return "hash-router"; }

  static get properties() {
    return {
      route: {
        type: Object,
        notify: true,
        observer: 'onRoute'
      },
      context: Object
    };
  }

  onRoute() {
    this.dispatchEvent(new CustomEvent('route-change', { bubbles: true, composed: true, detail: { route: this.route } }));
  }

  connectedCallback() {
    super.connectedCallback();
    if (this._attached) {
      return;
    }
    window.addEventListener("hashchange", () => {
      this.onHashChange();
    });
    this._attached = true;
    window.requestAnimationFrame(() => {
      this.onHashChange();
    });
  }

  goto(segments, context) {
    if (segments) {
      if (!Array.isArray(segments)) {
        segments = [segments];
      }
    }
    let hash = "#";
    if (segments && segments.length) {
      hash += segments[0];
      for (let i = 1; i < segments.length; i++) {
        const seg = segments[i];
        if (seg) {
          hash += "/" + encodeURIComponent(seg);
        }
      }
    }
    this.context = context || null;
    window.location.assign(hash);
  }

  onHashChange() {
    let hash = window.location.hash || "";
    if (hash) {
      hash = hash.substring(1);
    }
    const segments = hash.split("/") || [];
    for (var i = 1; i < segments.length; i++) {
      segments[i] = decodeURIComponent(segments[i]);
    }
    this.set("route", {
      segments: segments,
      context: this.context
    });
  }
}

window.customElements.define(HashRouter.is, HashRouter);