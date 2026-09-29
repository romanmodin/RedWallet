import { test; suite } "mo:test";
import List "mo:core/List";
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
  test("utxo parser accepts a well-formed list and rejects malformed shapes", func() {
    let body = "{\"result\":[{\"txid\":\"" # txid # "\",\"vout\":0,\"height\":123,\"value\":5000},{\"txid\":\"" # txid # "\",\"vout\":1,\"height\":0,\"value\":0}]}";
    switch (BridgeLib.parseAddressUtxos(body)) {
      case (?v) {
        assert v.utxos.size() == 2;
        assert v.utxos[0].txid == txid;
        assert v.utxos[0].vout == 0;
        assert v.utxos[0].height == 123;
        assert v.utxos[0].value == 5000;
        assert v.utxos[1].height == 0;
      };
      case null assert false;
    };
    assert BridgeLib.parseAddressUtxos("{\"result\":{}}") == null;
    assert BridgeLib.parseAddressUtxos("{\"result\":[{\"txid\":\"" # txid # "\",\"vout\":0,\"height\":1}]}") == null;
    assert BridgeLib.parseAddressUtxos("{\"result\":[{\"txid\":\"" # txid # "\",\"vout\":0,\"height\":1,\"value\":1}") == null;
    assert BridgeLib.parseAddressUtxos("{\"result\":[{\"txid\":\"" # txid # "\",\"vout\":0,\"vout\":1,\"height\":1,\"value\":1}]}") == null;
    assert BridgeLib.parseAddressUtxos("{\"error\":{},\"result\":[]}") == null;
    assert BridgeLib.parseAddressUtxos("") == null;
  });
  test("utxo parser enforces numeric and outpoint bounds", func() {
    assert BridgeLib.parseAddressUtxos("{\"result\":[{\"txid\":\"" # txid # "\",\"vout\":0,\"height\":-1,\"value\":1}]}") == null;
    assert BridgeLib.parseAddressUtxos("{\"result\":[{\"txid\":\"" # txid # "\",\"vout\":4294967296,\"height\":1,\"value\":1}]}") == null;
    assert BridgeLib.parseAddressUtxos("{\"result\":[{\"txid\":\"" # txid # "\",\"vout\":-1,\"height\":1,\"value\":1}]}") == null;
    assert BridgeLib.parseAddressUtxos("{\"result\":[{\"txid\":\"" # txid # "\",\"vout\":0,\"height\":1,\"value\":-1}]}") == null;
    assert BridgeLib.parseAddressUtxos("{\"result\":[{\"txid\":\"" # txid # "\",\"vout\":0,\"height\":1,\"value\":2100000000000001}]}") == null;
    assert BridgeLib.parseAddressUtxos("{\"result\":[{\"txid\":\"" # txid # "\",\"vout\":0,\"height\":1,\"value\":1.5}]}") == null;
    assert BridgeLib.parseAddressUtxos("{\"result\":[{\"txid\":\"" # txid # "\",\"vout\":0,\"height\":1,\"value\":1},{\"txid\":\"" # txid # "\",\"vout\":0,\"height\":2,\"value\":2}]}") == null;
    assert BridgeLib.parseAddressUtxos("{\"result\":[{\"txid\":\"AB" # "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" # "\",\"vout\":0,\"height\":1,\"value\":1}]}") == null;
    assert BridgeLib.parseAddressUtxos("{\"result\":[{\"txid\":\"ab\",\"vout\":0,\"height\":1,\"value\":1}]}") == null;
  });
  test("utxo parser rejects more than 1000 entries without truncating", func() {
    let entries = List.empty<Text>();
    var i = 0;
    while (i < 1001) {
      entries.add("{\"txid\":\"" # txid # "\",\"vout\":" # i.toText() # ",\"height\":1,\"value\":1}");
      i += 1;
    };
    let body = "{\"result\":[" # entries.toArray().values().join(",") # "]}";
    assert BridgeLib.parseAddressUtxos(body) == null;
  });
  test("raw transaction parser enforces hex shape and length", func() {
    switch (BridgeLib.parseRawTransaction("{\"result\":\"00ff\"}")) {
      case (?v) assert v.hex == "00ff";
      case null assert false;
    };
    assert BridgeLib.parseRawTransaction("{\"result\":\"\"}") == null;
    assert BridgeLib.parseRawTransaction("{\"result\":\"0\"}") == null;
    assert BridgeLib.parseRawTransaction("{\"result\":\"00FF\"}") == null;
    assert BridgeLib.parseRawTransaction("{\"result\":\"zz\"}") == null;
    assert BridgeLib.parseRawTransaction("{\"result\":{\"hex\":\"00ff\"}}") == null;
    assert BridgeLib.parseRawTransaction("{\"result\":\"00ff\",\"result\":\"00ff\"}") == null;
    assert BridgeLib.parseRawTransaction("{\"error\":{},\"result\":\"00ff\"}") == null;
    let chunks = List.empty<Text>();
    var i = 0;
    while (i < 100_001) { chunks.add("00"); i += 1 };
    let over = chunks.toArray().values().join("");
    assert over.size() > BridgeLib.maxRawTransactionHex;
    assert BridgeLib.parseRawTransaction("{\"result\":\"" # over # "\"}") == null;
  });
  test("HTTP auth and timeout errors never produce fake balances", func() {
    switch (BridgeLib.decodeResponse(response(401, "denied"), BridgeLib.parseBalance)) { case (#err(#backend_unavailable(_))) {}; case _ assert false };
    switch (BridgeLib.decodeResponse(response(504, "timeout"), BridgeLib.parseBalance)) { case (#err(#backend_unavailable(_))) {}; case _ assert false };
    switch (BridgeLib.decodeResponse(response(400, "invalid"), BridgeLib.parseBalance)) { case (#err(#invalid_input(_))) {}; case _ assert false };
  });
});
