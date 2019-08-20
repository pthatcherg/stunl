async function run() {
  const config = {
    iceServers: [{
      urls: "stun:127.0.0.1:3478",
    }]
  };
  const pc = new RTCPeerConnection(config);
  const dc = pc.createDataChannel("");
  const iceCandidates = new WaitableEvent();
  pc.onicecandidate = iceCandidates.handler;

  await triggerIce(pc);
  while (true) {
    const candidateEvt = await iceCandidates.next;
    const candidate = candidateEvt.candidate;
    if (!!candidate && candidate.type == "srflx") {
      const msg = extractMessageFromStunCandidate(candidate);
      // console.log(`Got message in STUN candidate: ${msg}`);
      appendMessage(msg);
    }

    await cycleConfiguration(pc);
    await triggerIce(pc);
  }
}

async function cycleConfiguration(pc) {
  const config1 = pc.getConfiguration();
  const config2 = pc.getConfiguration();
  // Bogus value; doesn't matter
  config1.iceServers[0].urls = "stun:127.0.0.1:1";
  await pc.setConfiguration(config1);
  await pc.setConfiguration(config2);
}

async function triggerIce(pc) {
  const offer = await pc.createOffer();
  // console.log(`Got offer ${offer.sdp}`);
  await pc.setLocalDescription(offer);
  // console.log(`Set local description ${offer.sdp}`);
}

function waitForCandidate(pc) {
  const candidate = new Promise((resolve, reject) => {
    pc.onicecandidate = evt => {
      resolve(candidate);
      pc.onicecandidate = null;
    };
  });
}

function appendMessage(msg) {
  const messagesNode = document.getElementById("messages");
  const msgNode = document.createElement("div");
  msgNode.appendChild(document.createTextNode(msg));
  messagesNode.appendChild(msgNode);
}

function extractMessageFromStunCandidate(candidate) {
  return bytesToString(bytesOfSerializedIp(candidate.address)) 
      + bytesToString(bytesOfBEUint16(candidate.port));
}

function bytesToString(bytes) {
  return bytes.map(s => String.fromCharCode(s)).join("");
}

function bytesOfSerializedIp(addr) {
  if (addr.includes(".")) {
    return addr.split(".").map(s => parseInt(s));
  } else {
    // TODO: Deal with "::" replacing ":::::".
    return addr.split("::").map(s => parseInt(s, 16));
  }
}

function bytesOfBEUint16(n) {
  return [n >> 8, n & 0xFF];
}

class WaitableEvent {
  constructor() {
    this._resolves = []
    this._events = []
  }

  get next() {
    if (this._events.length == 0) {
      return new Promise((resolve, reject) => {
        this._resolves.push(resolve);
      });
    }
    const evt = this._events[0];
    this._events.shift();
    return new Promise((resolve, reject) => {
      console.log(evt);
      resolve(evt);
    });
  }

  get handler() {
    return evt => this.handle(evt);
  }

  handle(evt) {
    if (this._resolves.length == 0) {
      this._events.push(evt);
      return;
    }
    const resolve = this._resolves[0];
    this._resolves.shift();
    resolve(evt);
  }
}
