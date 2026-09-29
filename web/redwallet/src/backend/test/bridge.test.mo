import { test; suite } "mo:test";
import BridgeLib "../lib/bridge";
import IC "mo:ic/Types";

let txid = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
func response(status : Nat, body : Text) : IC.HttpRequestResult {
  { status; body = body.encodeUtf8(); headers = [] };
};

suite("bridge client live contract", func() {
  test("configuration rejects plaintext URLs and header injection", func() {
    assert BridgeLib.validateBaseUrl("https://bridge.example.com") == null;
    assert BridgeLib.validateBaseUrl("http://bridge.example.com") != null;
    assert BridgeLib.validateBaseUrl("https://user@bridge.example.com") != null;
    assert BridgeLib.validateBaseUrl("https://bridge.example.com/") != null;
    assert not BridgeLib.validSecret("short");
    assert not BridgeLib.validSecret("01234567890123456789012345678901\n");
    assert BridgeLib.validSecret("01234567890123456789012345678901");
  });
  test("address inputs are bounded and escaped before paid calls", func() {
    assert BridgeLib.validAddress("bc1q86uhqahctvu7ygjenrcpp9c6dmxu6s8wzktfd4");
    assert not BridgeLib.validAddress("");
    assert not BridgeLib.validAddress("xbt-demo-address-not-valid");
    assert not BridgeLib.validAddress("bc1q\"],\"method\":\"bad");
    assert BridgeLib.addressParams("a\"b") == "[\"a\\\"b\"]";
  });
  test("requests carry bounded response and authenticated JSON array", func() {
    let req = BridgeLib.buildRequest("https://bridge.example.com", "token", BridgeLib.methodAddressBalance, "[\"address\"]", null);
    assert req.url == "https://bridge.example.com/rpc";
    assert req.max_response_bytes == ?BridgeLib.maxResponseBytes;
    assert req.is_replicated == ?false;
    assert req.headers[1].value == "Bearer token";
    assert BridgeLib.methodServerStatus == "server.status";
  });
  test("balance permits outgoing negative unconfirmed delta", func() {
    switch (BridgeLib.parseBalance("{\"result\":{\"confirmed\":1000,\"unconfirmed\":-500}}")) {
      case (?v) { assert v.confirmed == 1000; assert v.unconfirmed == -500 };
      case null assert false;
    };
    assert BridgeLib.parseBalance("{\"result\":{\"confirmed\":1000}}") == null;
    assert BridgeLib.parseBalance("{\"result\":{\"confirmed\":-1,\"unconfirmed\":0}}") == null;
    assert BridgeLib.parseBalance("{\"result\":{\"confirmed\":1.25,\"unconfirmed\":0}}") == null;
  });
  test("strict parser rejects malformed and conflicting JSON", func() {
    assert BridgeLib.parseBalance("{\"result\":{\"confirmed\":1,\"unconfirmed\":0}") == null;
    assert BridgeLib.parseBalance("{\"result\":{\"confirmed\":1,\"unconfirmed\":0}}junk") == null;
    assert BridgeLib.parseBalance("{\"result\":{\"confirmed\":1,\"confirmed\":2,\"unconfirmed\":0}}") == null;
    assert BridgeLib.parseBalance("{\"error\":{},\"result\":{\"confirmed\":1,\"unconfirmed\":0}}") == null;
    assert BridgeLib.parseBalance("") == null;
  });
  test("standard Fulcrum history needs no invented amount", func() {
    let body = "{\"result\":[{\"tx_hash\":\"" # txid # "\",\"height\":123},{\"tx_hash\":\"" # txid # "\",\"height\":0,\"fee\":200}]}";
    switch (BridgeLib.parseHistory(body)) {
      case (?v) { assert v.entries.size() == 2; assert v.entries[0].value == null; assert v.entries[1].height == 0 };
      case null assert false;
    };
    assert BridgeLib.parseHistory("{\"result\":[{\"tx_hash\":\"ab\",\"height\":1}]}") == null;
    assert BridgeLib.parseHistory("{\"result\":[}") == null;
    switch (BridgeLib.parseHistory("{\"result\":[]}")) { case (?v) assert v.entries.size() == 0; case null assert false };
  });
  test("fee conversion handles exponent and decimal numbers", func() {
    switch (BridgeLib.parseFeeEstimate("{\"result\":1e-7}")) { case (?v) assert v.satoshisPerKb == 10; case null assert false };
    switch (BridgeLib.parseFeeEstimate("{\"result\":0.00012}")) { case (?v) assert v.satoshisPerKb == 12000; case null assert false };
    assert BridgeLib.parseFeeEstimate("{\"result\":-1}") == null;
    assert BridgeLib.parseFeeEstimate("{\"result\":1e400}") == null;
    assert BridgeLib.parseFeeEstimate("{\"result\":\"fast\"}") == null;
  });
  test("server status contains actual height and verified checkpoint", func() {
    let body = "{\"result\":{\"height\":979950,\"serverVersion\":\"Fulcrum\",\"protocolVersion\":\"1.4\",\"checkpointVerified\":true,\"checkpointHeight\":973440,\"checkpointHash\":\"" # txid # "\"}}";
    switch (BridgeLib.parseServerStatus(body)) {
      case (?v) { assert v.height == 979950; assert v.checkpointConfigured; assert v.checkpointHeight == ?973440; assert v.checkpointHash == ?txid };
      case null assert false;
    };
    assert BridgeLib.parseServerStatus("{\"result\":[\"Fulcrum\",\"1.4\"]}") == null;
    let unconfigured = "{\"result\":{\"height\":1,\"serverVersion\":\"Fulcrum\",\"protocolVersion\":\"1.4\",\"checkpointVerified\":false,\"checkpointHeight\":null,\"checkpointHash\":null}}";
    switch (BridgeLib.parseServerStatus(unconfigured)) { case (?v) assert not v.checkpointConfigured; case null assert false };
  });
  test("HTTP auth and timeout errors never produce fake balances", func() {
    switch (BridgeLib.decodeResponse(response(401, "denied"), BridgeLib.parseBalance)) { case (#err(#backend_unavailable(_))) {}; case _ assert false };
    switch (BridgeLib.decodeResponse(response(504, "timeout"), BridgeLib.parseBalance)) { case (#err(#backend_unavailable(_))) {}; case _ assert false };
    switch (BridgeLib.decodeResponse(response(400, "invalid"), BridgeLib.parseBalance)) { case (#err(#invalid_input(_))) {}; case _ assert false };
  });
});
