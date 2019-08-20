async function run() {
  const config = {
    iceServers: [{
      urls: "stun:127.0.0.1:3478",
    }]
  };
  const pc = new RTCPeerConnection(config);
  const dc = pc.createDataChannel("");
  pc.onicecandidate = (evt) => {
    // console.log("Got local ICE candidate");
    const candidate = evt.candidate;
    if (!!candidate && candidate.type == "srflx") {
      const msg = extractMessageFromStunCandidate(candidate);
      // console.log(`Got message in STUN candidate: ${msg}`);
      appendMessage(msg);
    }
  };

  const offer = await pc.createOffer();
  // console.log(`Got offer ${offer.sdp}`);
  await pc.setLocalDescription(offer);
  // console.log(`Set local description ${offer.sdp}`);
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
