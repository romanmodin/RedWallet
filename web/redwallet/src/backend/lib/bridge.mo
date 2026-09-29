/// Bounded HTTPS requests and strict parsing of the bridge wire contract.
import Blob "mo:core/Blob";
import Float "mo:core/Float";
import Int "mo:core/Int";
import List "mo:core/List";
import Nat64 "mo:core/Nat64";
import Text "mo:core/Text";
import Json "mo:json";
import IC "mo:ic/Types";
import Types "../types/bridge";

module {
  public let maxResponseBytes : Nat64 = 262_144;
  public let methodServerVersion = "server.version";
  public let methodServerFeatures = "server.features";
  public let methodServerStatus = "server.status";
  public let methodAddressBalance = "address.balance";
  public let methodAddressHistory = "address.history";
  public let methodAddressUtxos = "address.utxos";
  public let methodRawTransaction = "transaction.raw";
  public let methodBroadcastTransaction = "transaction.broadcast";
  public let methodFeeEstimate = "fee.estimate";
  public let methodCheckpoint = "headers.checkpoint";
  public let defaultFeeTargetBlocks : Nat = 2;
  public let maxSafeInteger : Int = 9_007_199_254_740_991;
  public let maxUtxos : Nat = 1000;
  public let maxRawTransactionHex : Nat = 200_000;
  public let maxVout : Nat = 4_294_967_295;
  public let maxSatoshiValue : Nat = 2_100_000_000_000_000;

  /// Cheap bounds before paid outcalls. The bridge verifies checksums/network.
  public func validAddress(address : Text) : Bool {
    if (address.size() < 14 or address.size() > 90) return false;
    for (c in address.chars()) {
      if (not ((c >= 'a' and c <= 'z') or (c >= 'A' and c <= 'Z') or (c >= '0' and c <= '9'))) return false;
    };
    true;
  };

  public func addressParams(address : Text) : Text {
    Json.stringify(#array([#string(address)]), null);
  };

  /// Exactly one parameter: the validated address. The bridge derives the
  /// scripthash itself; the backend never sends a scripthash.
  public func addressUtxosParams(address : Text) : Text {
    Json.stringify(#array([#string(address)]), null);
  };

  /// Exactly one parameter: the 64-character hex transaction id. The bridge
  /// always requests the non-verbose raw transaction.
  public func rawTransactionParams(txid : Text) : Text {
    Json.stringify(#array([#string(txid)]), null);
  };

  public func buildRequestBody(method : Text, params : Text) : Text {
    "{\"method\":\"" # method # "\",\"params\":" # params # "}";
  };

  public func buildRequest(
    baseUrl : Text,
    secret : Text,
    method : Text,
    params : Text,
    transformFn : ?(shared query { context : Blob; response : IC.HttpRequestResult } -> async IC.HttpRequestResult),
  ) : IC.HttpRequestArgs {
    {
      url = baseUrl # "/rpc";
      method = #post;
      max_response_bytes = ?maxResponseBytes;
      body = ?(buildRequestBody(method, params).encodeUtf8());
      transform = switch (transformFn) {
        case (?fn) ?{ function = fn; context = [].toBlob() };
        case null null;
      };
      headers = [
        { name = "content-type"; value = "application/json" },
        { name = "authorization"; value = "Bearer " # secret },
      ];
      // One replica reads the operator's server. These are watch-only reads,
      // not consensus-verified financial proofs.
      is_replicated = ?false;
    };
  };

  public func validateBaseUrl(baseUrl : Text) : ?Types.BridgeError {
    if (not baseUrl.startsWith(#text "https://") or baseUrl.size() < 12 or baseUrl.size() > 2000) {
      return ?#invalid_input("bridge base URL must use https://");
    };
    for (c in baseUrl.chars()) {
      if (not ((c >= 'a' and c <= 'z') or (c >= 'A' and c <= 'Z') or (c >= '0' and c <= '9') or c == ':' or c == '/' or c == '.' or c == '-' or c == '_' or c == '~')) {
        return ?#invalid_input("bridge URL contains unsupported characters");
      };
    };
    if (baseUrl.endsWith(#text "/")) return ?#invalid_input("remove the trailing slash from the bridge URL");
    null;
  };

  public func validSecret(secret : Text) : Bool {
    if (secret.size() < 32 or secret.size() > 256) return false;
    for (c in secret.chars()) { if (c <= ' ' or c > '~') return false };
    true;
  };

  public func decodeResponse<T>(response : IC.HttpRequestResult, parse : Text -> ?T) : Types.BridgeResult<T> {
    switch (decodeBody(response)) {
      case (#err e) #err e;
      case (#ok body) switch (parse(body)) {
        case (?value) #ok value;
        case null #err(#malformed_response("bridge response has an invalid shape"));
      };
    };
  };

  public func decodeBody(response : IC.HttpRequestResult) : Types.BridgeResult<Text> {
    if (response.status == 400) return #err(#invalid_input("bridge rejected the address or request"));
    if (response.status < 200 or response.status >= 300) {
      return #err(#backend_unavailable("bridge returned status " # response.status.toText()));
    };
    if (response.body.size() > maxResponseBytes.toNat()) {
      return #err(#malformed_response("bridge response exceeded size limit"));
    };
    switch (response.body.decodeUtf8()) {
      case (?text) #ok text;
      case null #err(#malformed_response("bridge response was not valid UTF-8"));
    };
  };

  /// Parse the complete JSON document and reject conflicting object fields.
  func unwrapResult(body : Text) : ?Json.Json {
    let parsed = switch (Json.parse(body)) { case (#ok v) v; case (#err _) return null };
    if (not uniqueKeys(parsed)) return null;
    switch (parsed) {
      case (#object_(fields)) {
        var result : ?Json.Json = null;
        for ((key, value) in fields.values()) {
          if (key == "error") return null;
          if (key == "result") result := ?value;
        };
        result;
      };
      case _ null;
    };
  };

  func uniqueKeys(value : Json.Json) : Bool {
    switch (value) {
      case (#object_(fields)) {
        var i = 0;
        for ((key, item) in fields.values()) {
          var j = 0;
          while (j < i) { if (fields[j].0 == key) return false; j += 1 };
          if (not uniqueKeys(item)) return false;
          i += 1;
        };
      };
      case (#array(items)) { for (item in items.values()) { if (not uniqueKeys(item)) return false } };
      case _ {};
    };
    true;
  };

  func field(value : Json.Json, key : Text) : ?Json.Json {
    switch (value) {
      case (#object_(fields)) { for ((name, item) in fields.values()) { if (name == key) return ?item }; null };
      case _ null;
    };
  };

  func integer(value : Json.Json) : ?Int {
    switch (value) {
      case (#number(#int(n))) { if (n < -maxSafeInteger or n > maxSafeInteger) null else ?n };
      case _ null;
    };
  };
  func text(value : Json.Json) : ?Text { switch (value) { case (#string(s)) ?s; case _ null } };
  func boolean(value : Json.Json) : ?Bool { switch (value) { case (#bool(b)) ?b; case _ null } };

  public func isHex64(value : Text) : Bool {
    if (value.size() != 64) return false;
    for (c in value.chars()) {
      if (not ((c >= '0' and c <= '9') or (c >= 'a' and c <= 'f') or (c >= 'A' and c <= 'F'))) return false;
    };
    true;
  };

  /// Lowercase hex only: the bridge contract requires canonical lowercase txids.
  public func isLowerHex64(value : Text) : Bool {
    if (value.size() != 64) return false;
    for (c in value.chars()) {
      if (not ((c >= '0' and c <= '9') or (c >= 'a' and c <= 'f'))) return false;
    };
    true;
  };

  /// Nonempty, even-length, lowercase hex, bounded to `maxRawTransactionHex`.
  public func isRawTransactionHex(value : Text) : Bool {
    let size = value.size();
    if (size == 0 or size > maxRawTransactionHex or size % 2 != 0) return false;
    for (c in value.chars()) {
      if (not ((c >= '0' and c <= '9') or (c >= 'a' and c <= 'f'))) return false;
    };
    true;
  };

  public func parseBalance(body : Text) : ?Types.AddressBalance {
    let result = unwrapResult(body) ?? return null;
    let confirmed = integer(field(result, "confirmed") ?? return null) ?? return null;
    let unconfirmed = integer(field(result, "unconfirmed") ?? return null) ?? return null;
    if (confirmed < 0) return null;
    ?{ confirmed = confirmed.toNat(); unconfirmed };
  };

  public func parseHistory(body : Text) : ?Types.AddressHistory {
    let result = unwrapResult(body) ?? return null;
    let items = switch (result) { case (#array(v)) v; case _ return null };
    if (items.size() > 2000) return null;
    let entries = List.empty<Types.HistoryEntry>();
    for (item in items.values()) {
      let txid = text(field(item, "tx_hash") ?? return null) ?? return null;
      if (not isHex64(txid)) return null;
      let height = integer(field(item, "height") ?? return null) ?? return null;
      if (height < -1) return null;
      // Standard Fulcrum history lacks amount: absence must stay unknown.
      let value = switch (field(item, "value")) {
        case null null;
        case (?#null_) null;
        case (?v) ?(integer(v) ?? return null);
      };
      entries.add({ txid; height; value });
    };
    ?{ entries = entries.toArray() };
  };

  /// Strict parse of `blockchain.scripthash.listunspent` results. Rejects
  /// duplicate JSON fields, non-integer/unsafe numbers, negative heights,
  /// out-of-range vout, out-of-range values, duplicate outpoints, and more
  /// than `maxUtxos` entries (never a silent truncation).
  public func parseAddressUtxos(body : Text) : ?Types.AddressUtxos {
    let result = unwrapResult(body) ?? return null;
    let items = switch (result) { case (#array(v)) v; case _ return null };
    if (items.size() > maxUtxos) return null;
    let utxos = List.empty<Types.Utxo>();
    let seen = List.empty<Text>();
    for (item in items.values()) {
      let txid = text(field(item, "txid") ?? return null) ?? return null;
      if (not isLowerHex64(txid)) return null;
      let voutInt = integer(field(item, "vout") ?? return null) ?? return null;
      if (voutInt < 0 or voutInt > maxVout) return null;
      let height = integer(field(item, "height") ?? return null) ?? return null;
      if (height < 0) return null;
      let value = integer(field(item, "value") ?? return null) ?? return null;
      if (value < 0 or value > maxSatoshiValue) return null;
      let outpoint : Text = txid # ":" # voutInt.toText();
      if (seen.contains(outpoint)) return null;
      seen.add(outpoint);
      let vout : Nat32 = voutInt.toNat().toNat32();
      let utxoHeight : Nat = height.toNat();
      let utxoValue : Nat = value.toNat();
      utxos.add({ txid; vout; height = utxoHeight; value = utxoValue });
    };
    ?{ utxos = utxos.toArray() };
  };

  /// Strict parse of `blockchain.transaction.get(txid, false)`. The result must
  /// be a nonempty, even-length, lowercase hex string of at most
  /// `maxRawTransactionHex` characters; verbose objects are rejected.
  public func parseRawTransaction(body : Text) : ?Types.RawTransaction {
    let result = unwrapResult(body) ?? return null;
    let hex = text(result) ?? return null;
    if (not isRawTransactionHex(hex)) return null;
    ?{ hex };
  };

  /// Limit paid submission bytes before the bridge performs full structural checks.
  public func validSignedTransactionHex(raw : Text) : Bool {
    raw.size() <= 32_768 and isRawTransactionHex(raw);
  };

  public func parseBroadcastReceipt(body : Text, expectedTxid : Text) : ?Types.BroadcastReceipt {
    if (not isLowerHex64(expectedTxid)) return null;
    let result = unwrapResult(body) ?? return null;
    let txid = text(field(result, "txid") ?? return null) ?? return null;
    let outcome = text(field(result, "outcome") ?? return null) ?? return null;
    if (txid != expectedTxid or (outcome != "acknowledged" and outcome != "unknown")) return null;
    ?{ txid; outcome };
  };

  public func parseFeeEstimate(body : Text) : ?Types.FeeEstimate {
    let result = unwrapResult(body) ?? return null;
    let coinsPerKb = switch (result) {
      case (#number(#int(n))) n.toFloat();
      case (#number(#float(n))) n;
      case _ return null;
    };
    // Also rejects NaN, infinity, overflow and Fulcrum's unavailable sentinel.
    if (not (coinsPerKb >= 0.0 and coinsPerKb <= 100.0)) return null;
    let satoshisPerKb = Float.nearest(coinsPerKb * 100_000_000.0).toInt();
    ?{ satoshisPerKb = satoshisPerKb.toNat() };
  };

  public func parseServerStatus(body : Text) : ?Types.ServerStatus {
    let result = unwrapResult(body) ?? return null;
    let height = integer(field(result, "height") ?? return null) ?? return null;
    let serverVersion = text(field(result, "serverVersion") ?? return null) ?? return null;
    let protocolVersion = text(field(result, "protocolVersion") ?? return null) ?? return null;
    let checkpointConfigured = boolean(field(result, "checkpointVerified") ?? return null) ?? return null;
    if (height < 0 or serverVersion.size() == 0 or serverVersion.size() > 256 or protocolVersion.size() == 0 or protocolVersion.size() > 32) return null;
    let checkpointHeight = switch (field(result, "checkpointHeight")) {
      case (?#null_) null;
      case (?v) { let n = integer(v) ?? return null; if (n < 0) return null; ?n.toNat() };
      case null return null;
    };
    let checkpointHash = switch (field(result, "checkpointHash")) {
      case (?#null_) null;
      case (?v) { let hash = text(v) ?? return null; if (not isHex64(hash)) return null; ?hash };
      case null return null;
    };
    if (checkpointConfigured and (checkpointHeight == null or checkpointHash == null)) return null;
    if (not checkpointConfigured and (checkpointHeight != null or checkpointHash != null)) return null;
    let broadcastEnabled = switch (field(result, "broadcastEnabled")) {
      case null null;
      case (?value) ?(boolean(value) ?? return null);
    };
    ?{ serverVersion; protocolVersion; height; checkpointConfigured; checkpointHeight; checkpointHash; broadcastEnabled };
  };
};
