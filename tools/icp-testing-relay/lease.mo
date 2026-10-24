import Prim "mo:⛔";

// ICP controls service lifetime. Wallet traffic and backend addresses never enter the canister.
persistent actor class Lease(owner : Principal, reader : Principal, ttlSeconds : Nat) {
  assert owner != Prim.principalOfBlob("\04");
  assert reader != Prim.principalOfBlob("\04");
  let leaseReader = reader;
  assert ttlSeconds > 0 and ttlSeconds <= 2_592_000; // Hard maximum: 30 days.
  let administrator = owner;
  let deadline = Prim.nat64ToNat(Prim.time()) + ttlSeconds * 1_000_000_000;
  var revoked = false;
  var iosReceipt : ?Text = null;
  var androidReceipt : ?Text = null;

  type LeaseState = {
    active : Bool;
    deadline_ms : Int;
    ios_published : Bool;
    android_published : Bool;
  };

  func state() : LeaseState {
    {
      active = not revoked and Prim.nat64ToNat(Prim.time()) < deadline and not (iosReceipt != null and androidReceipt != null);
      deadline_ms = deadline / 1_000_000;
      ios_published = iosReceipt != null;
      android_published = androidReceipt != null;
    }
  };

  // Deliberately an update: dfx verifies its certified reply instead of trusting an unsigned HTTP response.
  public shared ({ caller }) func get_lease() : async LeaseState {
    assert caller == leaseReader or caller == administrator;
    state()
  };

  // The release verifier must supply actual PUBLIC production release receipts.
  // TestFlight upload, beta review, unsigned APKs and mere CI success do not qualify.
  public shared ({ caller }) func mark_published(platform : { #ios; #android }, receipt : Text) : async LeaseState {
    assert caller == administrator;
    assert receipt.size() > 0 and receipt.size() <= 512;
    switch platform {
      case (#ios) { if (iosReceipt == null) { iosReceipt := ?receipt } };
      case (#android) { if (androidReceipt == null) { androidReceipt := ?receipt } };
    };
    state()
  };

  public shared ({ caller }) func revoke() : async LeaseState {
    assert caller == administrator;
    revoked := true;
    state()
  };
};
