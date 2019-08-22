A proof of concept that one can tunnel arbitrary data in STUN packets between a
WebRTC client and a special STUN server.

It gets about 60kbps from server to client by embedding data in STUN mapped
address fields.

It gets about 200kbps from client to server by embedding data in ICE check
ufrags.

Tested only on a localhost network (127.0.0.1).

Currently limited to 500 messages from client to server because PeerConnections
aren't being garbage collected for some reason when sending.

The server to client traffic could probably be improved by making a special TURN
server that fakes ICE checks from the remote side and inserts data in the
address field that indicates where the packet came from, although it would have
a lot of overhead.

Directions:
- go run server.go
- open client.html in a browser
- If you want to test only one direction or different settings, edit the code
