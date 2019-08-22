// TODO:
// - Figure out why the PeerConnections aren't being garbage collected, which prevents
//   sending very much.
// - Use TURN and peer reflexive candidates instead?
// - Make WebTransport datagram API on top

async function run() {
  const serverIp = "127.0.0.1";
  const serverPort = 3478;
  receiveDataInStunAddress(serverIp, serverPort);
  sendDataInIceUfrag(serverIp, serverPort)
}

async function receiveDataInStunAddress(serverIp, serverPort) {
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
      runReceiverPeerConnection(serverAddr, requestIntervalMs, parallelRequests, iterationsPerPeerConnection, pcCloseDelayMillis, stats);
    }
    await runReceiverPeerConnection(serverAddr, requestIntervalMs, parallelRequests, iterationsPerPeerConnection, pcCloseDelayMillis, stats);
  }
}

async function runReceiverPeerConnection(serverAddr, requestIntervalMs, parallelRequests, iterationsPerPeerConnection, pcCloseDelayMillis, stats) {
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
    await startIceGathering(pc, {iceRestart: true});
  }
  setTimeout(() => pc.close(), pcCloseDelayMillis);
}

async function startIceGathering(pc, options) {
  const offer = await pc.createOffer(options);
  await pc.setLocalDescription(offer);
}

// Looks like we get about 100 messages per second, which would be up to
// 200kpbs from one peer connection at a time with one m-line.
async function sendDataInIceUfrag(serverIp, serverPort) {
  const dummyPc = new RTCPeerConnection({});

  let i = 0;
  while (true) {
    const payload = "Hello " + i++;
    await runSenderPeerConnection(serverIp, serverPort, dummyPc, payload);
  }
}

async function runSenderPeerConnection(serverIp, serverPort, dummyPc, payload) {
  const pc = new RTCPeerConnection({});
  const dc = pc.createDataChannel("");

  const offer = await pc.createOffer({iceRestart: true});
  console.log(`Got offer ${offer.sdp}`);
  await pc.setLocalDescription(offer);

  // This is the lazy way to make an answer.
  // Would probably be better to create one from scratch.
  await dummyPc.setRemoteDescription(offer)
  const answer = await dummyPc.createAnswer();

  // This can be up to 256 bytes post-encode, or 192 bytes pre-encode
  const iceUfrag = btoa(payload);
  const icePwd = "passwordpasswordpassword";
  let hackedSdp = answer.sdp.replace(/a=ice-ufrag:.*/, `a=ice-ufrag:${iceUfrag}`).replace(
      /a=ice-pwd:.*/, `a=ice-pwd:${icePwd}`);
  
  // console.log(hackedSdp);
  await pc.setRemoteDescription({
    type: "answer",
    sdp: hackedSdp
  });

  await pc.addIceCandidate({
    sdpMid: 0,
    candidate: `candidate:842163049 1 udp 1677732095 ${serverIp} ${serverPort} typ host`
  });
  // TODO: Figure out why this isn't being garbage collected.
  await pc.close()
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
    // substr ignores the "[" at the beginning and the "]" at the end
    // TODO: Deal with "::" replacing ":::::".
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
  // If you want to see the messages, uncomment htis line
  // appendMessage(msg);
  stats.messageCount += 1;
  // TODO: Count bytes, not chars
  stats.byteCount += msg.length;
  stats.timeElapsedMs = now() - stats.startTime;
  stats.throughputKbps = stats.byteCount * 8 / stats.timeElapsedMs;
  writeStats(stats);
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
