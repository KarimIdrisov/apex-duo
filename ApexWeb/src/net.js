// ApexWeb/src/net.js
// Transport abstraction. Game code uses send()/onMessage()/role only.

export class LocalNet {              // two tabs / Node: BroadcastChannel
  constructor(room, role) {
    this.role = role;
    this.ch = new BroadcastChannel(`apexweb-${room}`);
    this._cbs = [];
    this.ch.onmessage = (e) => { for (const cb of this._cbs) cb(e.data); };
  }
  send(msg) { this.ch.postMessage(msg); }
  onMessage(cb) { this._cbs.push(cb); }
  close() { this.ch.close(); }
}

export class P2PNet {                // real online via PeerJS (global `Peer` from CDN)
  constructor(role) { this.role = role; this._cbs = []; this.conn = null; }

  // host: returns the room code (peer id). client: pass host code to join.
  async host() {
    this.peer = new Peer();
    return new Promise((resolve) => {
      this.peer.on("open", (id) => resolve(id));
      this.peer.on("connection", (conn) => { this.conn = conn; this._bind(conn); });
    });
  }
  async join(code) {
    this.peer = new Peer();
    return new Promise((resolve, reject) => {
      this.peer.on("open", () => {
        this.conn = this.peer.connect(code);
        this.conn.on("open", () => resolve());
        this.conn.on("error", reject);
        this._bind(this.conn);
      });
    });
  }
  _bind(conn) { conn.on("data", (d) => { for (const cb of this._cbs) cb(d); }); }
  send(msg) { if (this.conn && this.conn.open) this.conn.send(msg); }
  onMessage(cb) { this._cbs.push(cb); }
  close() { if (this.peer) this.peer.destroy(); }
}
