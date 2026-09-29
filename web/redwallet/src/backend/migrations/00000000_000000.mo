import AccessControl "mo:caffeineai-authorization/access-control";

module {
  public type OldActor = {};
  public type NewActor = { accessControlState : AccessControl.AccessControlState };

  public func migration(_ : OldActor) : NewActor {
    { accessControlState = AccessControl.initState() };
  };
};
