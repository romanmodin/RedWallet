/// Read-only bridge API with independent operator authority and paid-call caps.
import Blob "mo:core/Blob";
import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Call "mo:ic/Call";
import IC "mo:ic/Types";
import BridgeLib "../lib/bridge";
import Types "../types/bridge";

mixin (bridgeConfig : Types.BridgeConfig, bridgeSecurity : Types.BridgeSecurity) {
  transient let minuteNs : Int = 60_000_000_000;
  transient let dayNs : Int = 86_400_000_000_000;
  transient var quotaMinute : Int = 0;
  transient var minuteCalls : Nat = 0;
  transient var activeCalls : Nat = 0;
  transient var generation : Nat = 0;
  transient var callers = Map.empty<Principal, Nat>();
  transient var cache = Map.empty<Text, { body : Text; at : Int }>();

  func isOperator(caller : Principal) : Bool {
    caller.isController() or (switch (bridgeSecurity.operator) {
      case (?operator) caller == operator;
      case null false;
    });
  };

  public query ({ caller }) func getBridgeOperatorStatus() : async Types.BridgeOperatorStatus {
    { isOperator = isOperator(caller); operatorConfigured = bridgeSecurity.operator != null };
  };

  /// Recovery/rotation is controller-only. Public login roles confer no power.
  public shared ({ caller }) func setBridgeOperator(operator : Principal) : async () {
    if (not caller.isController()) Runtime.trap("Unauthorized: controller required");
    if (operator.isAnonymous()) Runtime.trap("Operator must not be anonymous");
    bridgeSecurity.operator := ?operator;
  };

  func resetConnection() {
    generation += 1;
    cache := Map.empty();
    bridgeSecurity.checkpointVerified := false;
    bridgeSecurity.checkpointVerifiedAt := 0;
  };

  public shared ({ caller }) func setBridgeConfig(baseUrl : Text, secret : Text) : async () {
    if (not isOperator(caller)) Runtime.trap("Unauthorized: bridge operator required");
    switch (BridgeLib.validateBaseUrl(baseUrl)) {
      case (?_) Runtime.trap("Invalid HTTPS bridge base URL");
      case null {};
    };
    if (not BridgeLib.validSecret(secret)) Runtime.trap("Bridge secret must be 32 to 256 printable characters");
    bridgeConfig.baseUrl := baseUrl;
    bridgeConfig.secret := secret;
    resetConnection();
  };

  public shared ({ caller }) func clearBridgeConfig() : async () {
    if (not isOperator(caller)) Runtime.trap("Unauthorized: bridge operator required");
    bridgeConfig.baseUrl := "";
    bridgeConfig.secret := "";
    resetConnection();
  };

  public query func getBridgeStatus() : async Types.BridgeStatus {
    {
      configured = bridgeConfig.baseUrl.size() > 0 and bridgeConfig.secret.size() > 0;
      checkpointConfigured = bridgeSecurity.checkpointVerified and Time.now() - bridgeSecurity.checkpointVerifiedAt < 5 * minuteNs;
    };
  };

  public shared ({ caller }) func getAddressBalance(address : Text) : async Types.BridgeResult<Types.AddressBalance> {
    if (not BridgeLib.validAddress(address)) return #err(#invalid_input("invalid address format"));
    switch (await fetch(caller, BridgeLib.methodAddressBalance, BridgeLib.addressParams(address))) {
      case (#err e) #err e;
      case (#ok body) switch (BridgeLib.parseBalance(body)) {
        case (?value) #ok value;
        case null #err(#malformed_response("bridge balance response is invalid"));
      };
    };
  };

  public shared ({ caller }) func getAddressHistory(address : Text) : async Types.BridgeResult<Types.AddressHistory> {
    if (not BridgeLib.validAddress(address)) return #err(#invalid_input("invalid address format"));
    switch (await fetch(caller, BridgeLib.methodAddressHistory, BridgeLib.addressParams(address))) {
      case (#err e) #err e;
      case (#ok body) switch (BridgeLib.parseHistory(body)) {
        case (?value) #ok value;
        case null #err(#malformed_response("bridge history response is invalid"));
      };
    };
  };

  public shared ({ caller }) func getFeeEstimate() : async Types.BridgeResult<Types.FeeEstimate> {
    switch (await fetch(caller, BridgeLib.methodFeeEstimate, "[" # BridgeLib.defaultFeeTargetBlocks.toText() # "]")) {
      case (#err e) #err e;
      case (#ok body) switch (BridgeLib.parseFeeEstimate(body)) {
        case (?value) #ok value;
        case null #err(#backend_unavailable("Fulcrum has no usable fee estimate"));
      };
    };
  };

  public shared ({ caller }) func getServerStatus() : async Types.BridgeResult<Types.ServerStatus> {
    switch (await fetch(caller, BridgeLib.methodServerStatus, "[]")) {
      case (#err e) {
        bridgeSecurity.checkpointVerified := false;
        #err e;
      };
      case (#ok body) switch (BridgeLib.parseServerStatus(body)) {
        case (?value) {
          bridgeSecurity.checkpointVerified := value.checkpointConfigured;
          bridgeSecurity.checkpointVerifiedAt := Time.now();
          #ok value;
        };
        case null {
          bridgeSecurity.checkpointVerified := false;
          #err(#malformed_response("bridge status response is invalid"));
        };
      };
    };
  };

  public query func transformBridgeResponse(args : { context : Blob; response : IC.HttpRequestResult }) : async IC.HttpRequestResult {
    { status = args.response.status; body = args.response.body; headers = [] };
  };

  /// Reserve before awaiting so parallel requests cannot bypass the limit.
  /// Daily paid-call budget survives upgrades; the small minute map is bounded.
  func reserve(caller : Principal, now : Int) : Bool {
    let day = now / dayNs;
    if (bridgeSecurity.quotaDay != day) {
      bridgeSecurity.quotaDay := day;
      bridgeSecurity.quotaCalls := 0;
    };
    let minute = now / minuteNs;
    if (quotaMinute != minute) {
      quotaMinute := minute;
      minuteCalls := 0;
      callers := Map.empty();
    };
    if (activeCalls >= 6 or minuteCalls >= 120 or bridgeSecurity.quotaCalls >= 3000) return false;
    let used = switch (callers.get(caller)) { case (?n) n; case null 0 };
    let limit = if (caller.isAnonymous()) 60 else 20;
    if (used >= limit or (used == 0 and callers.size() >= 128)) return false;
    callers.add(caller, used + 1);
    minuteCalls += 1;
    bridgeSecurity.quotaCalls += 1;
    activeCalls += 1;
    true;
  };

  func fetch(caller : Principal, method : Text, params : Text) : async Types.BridgeResult<Text> {
    if (bridgeConfig.baseUrl.size() == 0 or bridgeConfig.secret.size() == 0) return #err(#not_configured);
    let now = Time.now();
    let key = method # params;
    switch (cache.get(key)) {
      case (?entry) { if (now - entry.at < 10_000_000_000) return #ok(entry.body) };
      case null {};
    };
    if (not reserve(caller, now)) return #err(#backend_unavailable("Read limit reached. Try again later."));
    let callGeneration = generation;
    let request = BridgeLib.buildRequest(bridgeConfig.baseUrl, bridgeConfig.secret, method, params, ?transformBridgeResponse);
    let response = try { await Call.httpRequest(request) } catch (_) {
      if (activeCalls > 0) activeCalls -= 1;
      return #err(#backend_unavailable("bridge request failed"));
    };
    if (activeCalls > 0) activeCalls -= 1;
    if (generation != callGeneration) return #err(#backend_unavailable("bridge configuration changed; refresh"));
    let result = BridgeLib.decodeBody(response);
    switch (result) {
      case (#ok body) {
        if (cache.size() >= 128) cache := Map.empty();
        cache.add(key, { body; at = Time.now() });
      };
      case (#err _) {};
    };
    result;
  };
};
