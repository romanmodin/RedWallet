import AccessControl "mo:caffeineai-authorization/access-control";
import MixinAuthorization "mo:caffeineai-authorization/MixinAuthorization";
import Expose "mo:caffeineai-oql/Expose";

import BridgeClientMixin "mixins/bridge-client";
import BridgeTypes "types/bridge";

actor {
  let accessControlState : AccessControl.AccessControlState;
  let bridgeConfig : BridgeTypes.BridgeConfig;
  let bridgeSecurity : BridgeTypes.BridgeSecurity;
  include MixinAuthorization(accessControlState, null);
  include BridgeClientMixin(bridgeConfig, bridgeSecurity);
  include Expose({ entities = [] });
};
