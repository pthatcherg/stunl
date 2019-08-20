// TODO:
// - Test throughput
// - Send requests with a certain frequency rather than after getting a response
//   (which would fail after 1 packet loss)
// - Run many PCs in parallel, or many STUN servers (ports) in parallel to get more throughput
// - Write to the server using remote ufrag
// - Make WebTransport datagram API on top


async function run() {
  const serverAddr = "127.0.0.1:3478";
  const requestIntervalMs = 10;
  const stats = {
    requestIntervalMs: requestIntervalMs,
    messageCount: 0,
    byteCount: 0,
    timeElapsedMs: 0,
    startTime: now(),
    throughputKbps: 0
  };

  const pc = new RTCPeerConnection({
    iceServers: [{
      urls: "stun:" + serverAddr,
    }]
  });
  const dc = pc.createDataChannel("");
  // const candidateEvents = new EventStream();
  // pc.onicecandidate = candidateEvents.handler;
  pc.onicecandidate = evt => {
    handleCandidate(evt.candidate, stats);
  }

  while (true) {
    await triggerIce(pc);
    sleep(requestIntervalMs)
    // await cycleConfiguration(pc);
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
  const offer = await pc.createOffer({iceRestart: true});
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
    console.log(addr)
    // TODO: Deal with "::" replacing ":::::".
    // substr ignores the "[" at the beginning and the "]" at the end
    return addr.substr(1, addr.length-2).split(":").flatMap(s => bytesOfBEUint16(parseInt(s, 16)));
  }
}

function bytesOfBEUint16(n) {
  return [n >> 8, n & 0xFF];
}

function handleCandidate(candidate, stats) {
  if (!candidate || candidate.type != "srflx") {
    return;
  }

  const msg = extractMessageFromStunCandidate(candidate);
  // console.log(`Got message in STUN candidate: ${msg}`);
  // console.log(evt);
  // appendMessage(msg);
  stats.messageCount += 1;
  stats.byteCount += msg.length;  // TODO: Count bytes, not chars
  // if ((stats.messageCount % 100) == 1) {
  stats.timeElapsedMs = now() - stats.startTime;
  stats.throughputKbps = stats.byteCount * 8 / stats.timeElapsedMs;
  // writeStats(stats);
  // }
}

function appendMessage(msg) {
  const messagesNode = document.getElementById("messages");
  const msgNode = document.createElement("div");
  msgNode.appendChild(document.createTextNode(msg));
  messagesNode.appendChild(msgNode);
}

function writeStats(stats) {
  document.getElementById("request-interval-ms").innerText = stats.requestIntervalMs;
  document.getElementById("message-count").innerText = stats.messageCount;
  document.getElementById("byte-count").innerText = stats.byteCount;
  document.getElementById("time-elapsed").innerText = stats.timeElapsedMs / 1000;
  document.getElementById("throughput-kbps").innerText = stats.throughputKbps;
}

function now() {
  return new Date().getTime();
}

function sleep(duration) {
  return new Promise((resolve, reject) => setTimeout(resolve, duration));
}

class EventStream {
  constructor() {
    this._resolves = []
    this._events = []
  }

  read() {
    if (this._events.length == 0) {
      return new Promise((resolve, reject) => {
        this._resolves.push(resolve);
      });
    }
    const evt = this._events[0];
    this._events.shift();
    return new Promise((resolve, reject) => {
      resolve(evt);
    });
  }

  write(evt) {
    if (this._resolves.length == 0) {
      this._events.push(evt);
      return;
    }
    const resolve = this._resolves[0];
    this._resolves.shift();
    resolve(evt);
  }

  get handler() {
    return evt => this.write(evt);
  }
}
