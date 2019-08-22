// TODO:
// - Write to the server using remote ufrag
// - Use TURN and peer reflexive candidates instead?
// - Make WebTransport datagram API on top

async function run() {
  const serverIp = "127.0.0.1";
  const serverPort = 3478;
  await sendDataOverIceUfrag(serverIp, serverPort)
  // await receiveDataOverStunAddress(serverIp, serverPort);
}

async function sendDataOverIceUfrag(serverIp, serverPort, payloads) {
  pc = new RTCPeerConnection({});
  const dc = pc.createDataChannel("");
  const offer = await pc.createOffer();
  console.log(`Got offer ${offer.sdp}`);
  await pc.setLocalDescription(offer);

  // This is the lazy way to make an answer.
  // Would probably be better to create one from scratch.
  const pc2 = new RTCPeerConnection({});
  await pc2.setRemoteDescription(offer)
  const answer = await pc2.createAnswer();
  // console.log(`Got answer ${answer.sdp}`);
  pc2.close();

  // This can be up to 256 bytes post-encode, or 192 bytes pre-encode
  const iceUfrag = btoa("this is a really big message.  so big you can't believe it");
  const icePwd = "passwordpasswordpassword";
  let hackedSdp = answer.sdp.replace(
      /a=ice-ufrag:.*/, `a=ice-ufrag:${iceUfrag}`).replace(
          /a=ice-pwd:.*/, `a=ice-pwd:${icePwd}`);
  
  console.log(hackedSdp);
  await pc.setRemoteDescription({
    type: "pranswer",  // pranswer gets ICE but doesn't do much else
    sdp: hackedSdp
  });

  await pc.addIceCandidate({
    sdpMid: 0,
    candidate: `candidate:842163049 1 udp 1677732095 ${serverIp} ${serverPort} typ host`
  });
  // Seems to send one message, which is OK.
  pc.close();
}

async function receiveDataOverStunAddress(serverIp, serverPort) {
  // It seems to get 60kbps on a localhost link
  // It seems to hit a problem after 100 packets or so
  const serverAddr = `${serverIp}:${serverPort}`;
  const parallelPeerConnections = 1;
  const parallelRequests = 5;
  const requestIntervalMs = 5;
  const iterationsPerPeerConnection = 2;
  const pcCloseDelayMillis = 200;  // Enough to wait for all the packets sent out
  const stats = {
    requestIntervalMs: requestIntervalMs,
    messageCount: 0,
    byteCount: 0,
    timeElapsedMs: 0,
    startTime: now(),
    throughputKbps: 0,
    peerConnectionCount: 0
  };
  writeStats(stats);
  while (true) {
    for (let i = 0; i < parallelPeerConnections-1; i++) {
      // Don't wait.  Let it run in parallel.
      runPeerConnection(serverAddr, requestIntervalMs, parallelRequests, iterationsPerPeerConnection, pcCloseDelayMillis, stats);
    }
    await runPeerConnection(serverAddr, requestIntervalMs, parallelRequests, iterationsPerPeerConnection, pcCloseDelayMillis, stats);
  }
}

async function runPeerConnection(serverAddr, requestIntervalMs, parallelRequests, iterationsPerPeerConnection, pcCloseDelayMillis, stats) {
  stats.peerConnectionCount += 1;
  const pc = new RTCPeerConnection({
    iceServers: [{
      urls: "stun:" + serverAddr,
    }]
  });
  for (let i = 0; i < parallelRequests; i++) {
    pc.addTransceiver("audio");
  }
  pc.onicecandidate = evt => {
    handleCandidate(evt.candidate, stats);
  }
  await startIceGathering(pc);
  for (let i = 0; i < iterationsPerPeerConnection-1; i++) {
    await sleep(requestIntervalMs);
    // triggerIce seems to be faster than cycleConfiguration,
    // but cycleConfiguration works as well
    await startIceGathering(pc, {iceRestart: true});
    // await cycleConfiguration(pc);
  }
  setTimeout(() => pc.close(), pcCloseDelayMillis);
}

async function startIceGathering(pc, options) {
  const offer = await pc.createOffer(options);
  // console.log(`Got offer ${offer.sdp}`);
  await pc.setLocalDescription(offer);
  // console.log(`Set local description ${offer.sdp}`);
}

async function cycleConfiguration(pc) {
  const config1 = pc.getConfiguration();
  const config2 = pc.getConfiguration();
  // Bogus value; doesn't matter
  config1.iceServers[0].urls = "stun:127.0.0.1:1";
  await pc.setConfiguration(config1);
  await pc.setConfiguration(config2);
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
    // console.log(addr)
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
  console.log(candidate.candidate);
  // console.log(candidate.address);
  // appendMessage(msg);
  stats.messageCount += 1;
  stats.byteCount += msg.length;  // TODO: Count bytes, not chars
  // if ((stats.messageCount % 100) == 1) {
  stats.timeElapsedMs = now() - stats.startTime;
  stats.throughputKbps = stats.byteCount * 8 / stats.timeElapsedMs;
  writeStats(stats);
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
  document.getElementById("peer-connection-count").innerText = stats.peerConnectionCount;
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
