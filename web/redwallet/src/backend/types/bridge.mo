/// Types for the HTTPS-to-Fulcrum bridge client.
///
/// The canister never speaks raw TCP/TLS to Fulcrum. It calls a separately
/// deployed HTTPS bridge over the IC management canister `http_request`
/// outcall. These types describe the bridge configuration held in stable
/// state and the typed read results returned to callers.
module {
  /// Operator-configured bridge connection. `baseUrl` must be an `https://`
  /// URL; `secret` is the deployment secret sent as a bearer token. Neither
  /// value is ever returned in a frontend-facing response.
  public type BridgeConfig = {
    var baseUrl : Text;
    var secret : Text;
  };

  /// Bridge authority is independent of the template's first-login role.
  /// Only a canister controller may appoint/rotate the operator.
  public type BridgeSecurity = {
    var operator : ?Principal;
    var checkpointVerified : Bool;
    var checkpointVerifiedAt : Int;
    var quotaDay : Int;
    var quotaCalls : Nat;
  };

  public type BridgeOperatorStatus = {
    isOperator : Bool;
    operatorConfigured : Bool;
  };

  /// Non-secret configuration status. Reports only whether a bridge is
  /// configured and whether the checkpoint/network identity is configured.
  public type BridgeStatus = {
    configured : Bool;
    checkpointConfigured : Bool;
  };

  /// Why a read could not be served. Every read returns one of these instead
  /// of demo or fabricated data.
  public type BridgeError = {
    /// No bridge base URL/secret has been configured by an operator yet.
    #not_configured;
    /// The bridge was unreachable, timed out, or rejected authentication.
    #backend_unavailable : Text;
    /// The caller supplied an invalid address or other input.
    #invalid_input : Text;
    /// The bridge answered, but the response was malformed or unexpected.
    #malformed_response : Text;
  };

  /// Result of a read routed through the bridge.
  public type BridgeResult<T> = {
    #ok : T;
    #err : BridgeError;
  };

  /// Address balance as reported by the bridge.
  public type AddressBalance = {
    confirmed : Nat;
    unconfirmed : Int;
  };

  /// One address history entry as reported by the bridge.
  public type HistoryEntry = {
    txid : Text;
    height : Int;
    value : ?Int;
  };

  /// Address history as reported by the bridge.
  public type AddressHistory = {
    entries : [HistoryEntry];
  };

  /// Fee estimate as reported by the bridge, in satoshis per kilobyte.
  public type FeeEstimate = {
    satoshisPerKb : Nat;
  };

  /// One unspent transaction output for an address, as reported by the bridge.
  /// `txid` is a 64-character lowercase hex string; `vout` is the output index
  /// within that transaction; `height` is the confirming block height (0 for an
  /// unconfirmed output); `value` is the output amount in satoshis.
  public type Utxo = {
    txid : Text;
    vout : Nat32;
    height : Nat;
    value : Nat;
  };

  /// Unspent outputs for one address. The list is capped at 1000 entries; a
  /// larger upstream result is an explicit error, never a silent truncation.
  public type AddressUtxos = {
    utxos : [Utxo];
  };

  /// Raw transaction bytes as reported by the bridge, hex-encoded and
  /// lowercased. Nonempty, even length, at most 200000 hex characters.
  /// Submitted signed bytes only; acknowledged does not mean confirmed.
  public type BroadcastReceipt = { txid : Text; outcome : Text };

  public type RawTransaction = {
    hex : Text;
  };

  /// Server/network status as reported by the bridge. The checkpoint is
  /// reported as unconfigured because no verified project source defines an
  /// XBT checkpoint/network identity; no BTC-compatibility claim is made.
  public type ServerStatus = {
    serverVersion : Text;
    protocolVersion : Text;
    height : Int;
    checkpointConfigured : Bool;
    checkpointHeight : ?Nat;
    checkpointHash : ?Text;
    broadcastEnabled : ?Bool;
  };
};
