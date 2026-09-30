import AccessControl "mo:caffeineai-authorization/access-control";
import MixinAuthorization "mo:caffeineai-authorization/MixinAuthorization";
import Expose "mo:caffeineai-oql/Expose";

import ApiDocMixin "mixins/api-doc";
import BridgeClientMixin "mixins/bridge-client";
import BridgeTypes "types/bridge";
import NeoxexPriceMixin "mixins/neoxex-price";

actor {
  let accessControlState : AccessControl.AccessControlState;
  let bridgeConfig : BridgeTypes.BridgeConfig;
  let bridgeSecurity : BridgeTypes.BridgeSecurity;
  include MixinAuthorization(accessControlState, null);
  include BridgeClientMixin(bridgeConfig, bridgeSecurity);
  include ApiDocMixin();
  include NeoxexPriceMixin();
  include Expose({ entities = [] });
};
