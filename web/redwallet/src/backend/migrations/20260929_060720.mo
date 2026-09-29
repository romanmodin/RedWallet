import AccessControl "mo:caffeineai-authorization/access-control";

module {
  public type OldActor = { accessControlState : AccessControl.AccessControlState };
  public type NewActor = {
    accessControlState : AccessControl.AccessControlState;
    bridgeConfig : { var baseUrl : Text; var secret : Text };
  };

  public func migration(old : OldActor) : NewActor {
    {
      accessControlState = old.accessControlState;
      bridgeConfig = { var baseUrl = ""; var secret = "" };
    };
  };
};
