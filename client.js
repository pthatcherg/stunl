// TODO:
// - Figure out why the PeerConnections aren't being garbage collected, which prevents
//   sending very much.
// - Figure out why recycling m-lines slows down PeerConnections.
// - Use TURN and peer reflexive candidates instead?
// - Make WebTransport datagram API on top


async function run() {
  const serverIp = "127.0.0.1";
  const serverPort = 3478;
  ice = null;
  try {
    // New APIs available.  We can avoid PeerConnection.
    ice = new RTCIceTransport();
  } catch {
  }

  if (!!ice) {
    // This seems to handle about 200kbps with 25 in parallel.
    receiveDataInStunAddressUsingIceTransports(serverIp, serverPort);
    // This seems to handle 354kbps with just one at at time.
    sendDataInIceUfragUsingIceTransports(serverIp, serverPort);
  } else {
    // It seems to get 60kbps on a localhost link
    // It seems to hit a problem after 100 packets or so
    receiveDataInStunAddressUsingPeerConnections(serverIp, serverPort);
    // Looks like we get about 100 messages per second, which would be up to
    // 200kpbs from one peer connection at a time with one m-line.
    // Setting 'recycle' to true slows down the messages over time, but
    // it never runs out of PeerConnections.
    const recycle = true;
    sendDataInIceUfragUsingPeerConnections(serverIp, serverPort, recycle);
  }
}

async function receiveDataInStunAddressUsingPeerConnections(serverIp, serverPort) {
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
      receivePayloadInStunAddressUsingPeerConnection(serverAddr, requestIntervalMs, parallelRequests, iterationsPerPeerConnection, pcCloseDelayMillis, stats);
    }
    await receivePayloadInStunAddressUsingPeerConnection(serverAddr, requestIntervalMs, parallelRequests, iterationsPerPeerConnection, pcCloseDelayMillis, stats);
  }
}

async function receivePayloadInStunAddressUsingPeerConnection(serverAddr, requestIntervalMs, parallelRequests, iterationsPerPeerConnection, pcCloseDelayMillis, stats) {
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

async function sendDataInIceUfragUsingPeerConnections(serverIp, serverPort, recycle) {
  const pc = new RTCPeerConnection({});
  const dummyPc = new RTCPeerConnection({});
  let i = 0;
  while (true) {
    const payload = "Hello " + i++;
    await sendPayloadInIceUfragUsingPeerConnection(serverIp, serverPort, dummyPc, pc, payload, recycle);
  }
}

async function sendPayloadInIceUfragUsingPeerConnection(serverIp, serverPort, dummyPc, pc, payload, recycle) {
  if (!recycle) {
    pc = new RTCPeerConnection({});
  }
  pc.addTransceiver("audio");

  const offer = await pc.createOffer({iceRestart: true});
  // console.log(`Got local offer ${offer.sdp}`);
  await pc.setLocalDescription(offer);

  // This is the lazy way to make an answer.
  // Would probably be better to create one from scratch.
  await dummyPc.setRemoteDescription(offer)
  const answer = await dummyPc.createAnswer();
  // console.log(`Got remote answer ${answer.sdp}`);
  await dummyPc.setLocalDescription(answer);

  // This can be up to 256 bytes post-encode, or 192 bytes pre-encode
  const iceUfrag = btoa(payload);
  const icePwd = "passwordpasswordpassword";
  let hackedAnswerSdp = answer.sdp.replace(/a=ice-ufrag:.*/, `a=ice-ufrag:${iceUfrag}`).replace(
      /a=ice-pwd:.*/, `a=ice-pwd:${icePwd}`);
  
  await pc.setRemoteDescription({
    type: "answer",
    sdp: hackedAnswerSdp
  });

  await pc.addIceCandidate({
    sdpMLineIndex: 0,
    candidate: `candidate:842163049 1 udp 1677732095 ${serverIp} ${serverPort} typ host`,
  });

  if (recycle) {
    // In the meantime, instead, recycle the m-line.
    const stoppedOfferSdp = offer.sdp.replace("m=audio 9", "m=audio 0");
    // console.log(`Stopped offer: ${stoppedOfferSdp}`);
    await pc.setLocalDescription({
      type: "offer",
      sdp: stoppedOfferSdp,
    });
    await dummyPc.setRemoteDescription({
      type: "offer",
      sdp: stoppedOfferSdp,
    });
    const stoppedAnswer = await dummyPc.createAnswer();
    // console.log(`Stopped answer: ${stoppedAnswer.sdp}`);
    await dummyPc.setLocalDescription(stoppedAnswer);
    await pc.setRemoteDescription(stoppedAnswer);
  } else {
    pc.close();
  }
}

async function sendDataInIceUfragUsingIceTransports(serverIp, serverPort) {
  let i = 0;
  while (true) {
    const payload = "Hello " + i++;
    await sendPayloadInIceUfragUsingIceTransport(serverIp, serverPort, payload);
  }
}

async function sendPayloadInIceUfragUsingIceTransport(serverIp, serverPort, payload) {
  const ice = new RTCIceTransport();
  ice.start({
    usernameFragment: btoa(payload),
    password: "passwordpasswordpassword"
  });
  ice.addRemoteCandidate(new RTCIceCandidate({
    sdpMid: "", 
    candidate: `candidate:0 0 UDP 0 ${serverIp} ${serverPort} typ host`
  }));
  ice.gather({});
  // Seems to be enough for one packet to escape.
  await sleep(1);
  ice.stop();
}

async function receiveDataInStunAddressUsingIceTransports(serverIp, serverPort) {
  const serverAddr = `${serverIp}:${serverPort}`;
  const requestIntervalMs = 5;
  const parallelRequests = 25;
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
    for (let i = 0; i < parallelRequests; i++) {
      receivePayloadInStunAddressUsingIceTransport(serverAddr, stats);
    }
    await receivePayloadInStunAddressUsingIceTransport(serverAddr, stats);
    await sleep(requestIntervalMs-1);
  }
}

async function receivePayloadInStunAddressUsingIceTransport(serverAddr, stats) {
  const ice = new RTCIceTransport();
  ice.onicecandidate = evt => {
    handleCandidate(evt.candidate, stats);
  }
  ice.gather({
    iceServers: [{
      urls: "stun:" + serverAddr,
    }]
  });
  // Seems to be enough for one packet to escape.
  await sleep(10);
  ice.stop();
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
