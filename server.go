package main

import (
	"encoding/binary"
	"log"
	"net"
)

const (
	stunHeaderSize     = 20
	stunMagicCookie    = 0x2112A442
	stunAttrHeaderSize = 4

	stunBindingRequestType  = 0x0001
	stunBindingResponseType = 0x0101

	stunMappedAddressAttrType = 0x0001
)

type stunBindingRequest struct {
	transactionId []byte
	attrs         []stunAttr
}

type stunBindingResponse struct {
	transactionId []byte
	attrs         []stunAttr
}

type stunAttr struct {
	typ   uint16
	value []byte
}

func main() {
	localAddr := "0.0.0.0:3478"
	conn, err := net.ListenPacket("udp", localAddr)
	if err != nil {
		log.Fatalf("Failed to listen on UDP %s", localAddr)
	}
	for {
		buf := make([]byte, 1500)
		packetLen, remoteAddr, err := conn.ReadFrom(buf)
		if err != nil {
			log.Fatalf("Failed to read from UDP %s", localAddr)
		}

		request := parseStunBindingRequest(buf[:packetLen])
		if request == nil {
			continue
		}

		response := stunBindingResponse{
			transactionId: request.transactionId,
			attrs: []stunAttr{
				{
					typ: stunMappedAddressAttrType,
					// value: serializeStunAddressAttrV6([]byte("MESSAGE........."), 34171),
					value: serializeStunAddressAttrV6([]byte("MESG"), 34171),
				},
			},
		}

		log.Printf("Got %#v and sending %#v", request, response)

		conn.WriteTo(serializeStunBindingResponse(response), remoteAddr)
		if err != nil {
			log.Fatalf("Failed to write from UDP %s to %s", localAddr, remoteAddr)
		}
	}
}

func parseStunBindingRequest(p []byte) *stunBindingRequest {
	if len(p) < stunHeaderSize {
		return nil
	}
	stunType := binary.BigEndian.Uint16(p[0:2])
	attrsLength := binary.BigEndian.Uint16(p[2:4])
	cookie := binary.BigEndian.Uint32(p[4:8])
	transactionId := p[8:20]
	unparsedAttrs := p[20:]
	if stunType != stunBindingRequestType {
		return nil
	}

	if cookie != 0x2112A442 {
		return nil
	}

	if int(attrsLength) > len(unparsedAttrs) {
		return nil
	}

	var parsedAttrs []stunAttr
	for {
		if len(unparsedAttrs) < stunAttrHeaderSize {
			break
		}
		attrType := binary.BigEndian.Uint16(unparsedAttrs[0:2])
		attrLength := binary.BigEndian.Uint16(unparsedAttrs[2:4])
		attrValue := unparsedAttrs[4:]
		if int(attrLength) > len(attrValue) {
			break
		}

		parsedAttrs = append(parsedAttrs, stunAttr{
			typ:   attrType,
			value: copyBytes(attrValue[:attrLength]),
		})

		unparsedAttrs = unparsedAttrs[(stunAttrHeaderSize + roundUpTo4ByteBoundary(int(attrLength))):]
	}

	return &stunBindingRequest{
		transactionId: copyBytes(transactionId),
		attrs:         parsedAttrs,
	}
}

func serializeStunBindingResponse(resp stunBindingResponse) []byte {
	size := stunHeaderSize
	for _, attr := range resp.attrs {
		size += (stunAttrHeaderSize + roundUpTo4ByteBoundary(len(attr.value)))
	}

	p := make([]byte, size)
	binary.BigEndian.PutUint16(p[0:2], stunBindingResponseType)
	binary.BigEndian.PutUint16(p[2:4], 0)
	binary.BigEndian.PutUint32(p[4:8], stunMagicCookie)
	copy(p[8:20], resp.transactionId)

	attrBuffer := p[20:]
	for _, attr := range resp.attrs {
		binary.BigEndian.PutUint16(attrBuffer[0:2], attr.typ)
		binary.BigEndian.PutUint16(attrBuffer[2:4], uint16(len(attr.value)))
		copy(attrBuffer[4:], attr.value)
		attrBuffer = attrBuffer[(stunAttrHeaderSize + roundUpTo4ByteBoundary(len(attr.value))):]
	}
	return p
}

func serializeStunAddressAttrV6(address []byte, port uint16) []byte {
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
