// TODO:
// - Don't send the send thing twice to the same transaction ID (ignore resends)
// - Use TURN and peer reflexive candidates instead?

package main

import (
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"log"
	"net"
	"strings"
)

const (
	stunHeaderSize     = 20
	stunMagicCookie    = 0x2112A442
	stunAttrHeaderSize = 4

	stunBindingRequestType  = 0x0001
	stunBindingResponseType = 0x0101

	stunMappedAddressAttrType = 0x0001
	stunUsernameAttrType      = 0x0006
)

type stunMessage struct {
	typ           uint16
	transactionId []byte
	attrs         []stunAttr
}

type stunAttr struct {
	typ   uint16
	value []byte
}

func (msg stunMessage) findAttr(attrType uint16) *stunAttr {
	for _, attr := range msg.attrs {
		if attr.typ == attrType {
			return &attr
		}
	}
	return nil
}

func main() {
	payloads := make(chan []byte)
	go func() {
		for i := 0; true; i++ {
			payloads <- []byte(fmt.Sprintf("Hi %15d", i))
		}
	}()

	localAddr := "0.0.0.0:3478"
	conn, err := net.ListenPacket("udp4", localAddr)
	if err != nil {
		log.Fatalf("Failed to listen on UDP %s", localAddr)
	}
	log.Printf("Listening on %s", conn.LocalAddr())
	for {
		buf := make([]byte, 1500)
		packetLen, remoteAddr, err := conn.ReadFrom(buf)
		if err != nil {
			log.Fatalf("Failed to read from UDP %s", localAddr)
		}

		msg := parseStunMessage(buf[:packetLen])
		if msg == nil {
			log.Printf("Failed to parse %v", buf[:packetLen])
			continue
		}

		var response stunMessage
		if msg.typ != stunBindingRequestType {
			log.Printf("Unknown stun message type: %d\n", msg.typ)
		}
		username := msg.findAttr(stunUsernameAttrType)
		if username != nil {
			// log.Printf("Got stun ping with username: %s", username.value)
			remoteUfrag := strings.SplitN(string(username.value), ":", 2)[0]
			payload, err := base64.StdEncoding.DecodeString(remoteUfrag)
			if err != nil {
				log.Printf("Failed to decode remote ufrag %s.", remoteUfrag)
				continue
			}
			log.Printf("Got %s from %s", string(payload), remoteAddr)
			continue
		}

		// Must be a normal STUN binding request (not an ICE check)
		request := msg
		payload := <-payloads
		response = stunMessage{
			typ:           stunBindingResponseType,
			transactionId: request.transactionId,
			attrs: []stunAttr{
				{
					typ:   stunMappedAddressAttrType,
					value: serializeBytesAsStunAddressAttrV6(payload),
				},
			},
		}

		log.Printf("Sent %s to %s", payload, remoteAddr)

		conn.WriteTo(serializeStunMessage(response), remoteAddr)
		if err != nil {
			log.Fatalf("Failed to write from UDP %s to %s", localAddr, remoteAddr)
		}
	}
}

func parseStunMessage(p []byte) *stunMessage {
	var msg stunMessage
	if len(p) < stunHeaderSize {
		return nil
	}

	msg.typ = binary.BigEndian.Uint16(p[0:2])
	attrsLength := binary.BigEndian.Uint16(p[2:4])
	cookie := binary.BigEndian.Uint32(p[4:8])
	msg.transactionId = copyBytes(p[8:20])
	unparsedAttrs := p[20:]

	if cookie != 0x2112A442 {
		return nil
	}

	if int(attrsLength) > len(unparsedAttrs) {
		return nil
	}

	for {
		if len(unparsedAttrs) < stunAttrHeaderSize {
			break
		}
		var attr stunAttr
		attr.typ = binary.BigEndian.Uint16(unparsedAttrs[0:2])
		attrLength := binary.BigEndian.Uint16(unparsedAttrs[2:4])
		if int(attrLength) > len(unparsedAttrs[4:]) {
			break
		}
		attr.value = copyBytes(unparsedAttrs[4 : 4+attrLength])
		msg.attrs = append(msg.attrs, attr)

		unparsedAttrs = unparsedAttrs[(stunAttrHeaderSize + roundUpTo4ByteBoundary(int(attrLength))):]
	}
	return &msg
}

func serializeStunMessage(msg stunMessage) []byte {
	size := stunHeaderSize
	for _, attr := range msg.attrs {
		size += (stunAttrHeaderSize + roundUpTo4ByteBoundary(len(attr.value)))
	}

	p := make([]byte, size)
	binary.BigEndian.PutUint16(p[0:2], msg.typ)
	binary.BigEndian.PutUint16(p[2:4], uint16(size-stunHeaderSize))
	binary.BigEndian.PutUint32(p[4:8], stunMagicCookie)
	copy(p[8:20], msg.transactionId)

	attrBuffer := p[20:]
	for _, attr := range msg.attrs {
		binary.BigEndian.PutUint16(attrBuffer[0:2], attr.typ)
		binary.BigEndian.PutUint16(attrBuffer[2:4], uint16(len(attr.value)))
		copy(attrBuffer[4:], attr.value)
		attrBuffer = attrBuffer[(stunAttrHeaderSize + roundUpTo4ByteBoundary(len(attr.value))):]
	}
	return p
}

func serializeBytesAsStunAddressAttrV6(mesg []byte) []byte {
	return serializeBytesAsStunAddressAttr(mesg, 16, 2)
}

func serializeBytesAsStunAddressAttrV4(mesg []byte) []byte {
	return serializeBytesAsStunAddressAttr(mesg, 4, 2)
}

func serializeBytesAsStunAddressAttr(mesg []byte, addressLength, portLength int) []byte {
	addressPortLength := addressLength + portLength
	if len(mesg) > addressPortLength {
		panic("Message is too big.")
	}
	if len(mesg) < addressPortLength {
		panic("Message is too small.")
	}
	return serializeStunAddressAttr(mesg[:addressLength], binary.BigEndian.Uint16(mesg[addressLength:]))
}

func serializeStunAddressAttr(address []byte, port uint16) []byte {
	var family uint16 = 0
	if len(address) == 4 {
		family = 1 // ipv4
	} else if len(address) == 16 {
		family = 2 // ipv6
	} else {
		panic("Address must be either ipv6 (16 bytes) or ipv4 (4 bytes)")
	}

	attrValue := make([]byte, 4+len(address))
	binary.BigEndian.PutUint16(attrValue[0:2], family)
	binary.BigEndian.PutUint16(attrValue[2:4], port)
	copy(attrValue[4:], address)
	return attrValue
}

func roundUpTo4ByteBoundary(val int) int {
	rem := val % 4
	if rem > 0 {
		return val + 4 - rem
	}
	return val
}

func copyBytes(s []byte) []byte {
	c := make([]byte, len(s))
	copy(c, s)
	return c
}
