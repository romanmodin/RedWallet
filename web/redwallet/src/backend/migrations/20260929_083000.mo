import AccessControl "mo:caffeineai-authorization/access-control";
import Principal "mo:core/Principal";

module {
  public type OldActor = {
    accessControlState : AccessControl.AccessControlState;
    bridgeConfig : { var baseUrl : Text; var secret : Text };
  };
  public type NewActor = {
    accessControlState : AccessControl.AccessControlState;
    bridgeConfig : { var baseUrl : Text; var secret : Text };
    bridgeSecurity : {
      var operator : ?Principal;
      var checkpointVerified : Bool;
      var checkpointVerifiedAt : Int;
      var quotaDay : Int;
      var quotaCalls : Nat;
    };
  };
  public func migration(old : OldActor) : NewActor {
    // Disable automatic first-user promotion. The independent bridge operator
    // is an app-specific identity whose private key is retained on Umbrel.
    old.accessControlState.adminAssigned := true;
    {
      accessControlState = old.accessControlState;
      // A previous first-login admin could have configured an endpoint. The
      // pinned operator must explicitly configure the hardened deployment.
      bridgeConfig = { var baseUrl = ""; var secret = "" };
      bridgeSecurity = {
        var operator = ?Principal.fromText("nxkke-m27nb-dfnhs-cw533-g6lfi-ajhii-ffhn2-rhyb2-e5af4-aoarh-dqe");
        var checkpointVerified = false;
        var checkpointVerifiedAt = 0;
        var quotaDay = 0;
        var quotaCalls = 0;
      };
    };
  };
};
