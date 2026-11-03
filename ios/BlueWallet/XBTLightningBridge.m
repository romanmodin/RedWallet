#import <TargetConditionals.h>
#if TARGET_OS_IOS && !TARGET_OS_MACCATALYST
#import <React/RCTBridgeModule.h>
@interface RCT_EXTERN_MODULE(XBTLightningBridge, NSObject)
RCT_EXTERN_METHOD(run:(NSString *)action resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(invoice:(NSString *)operation value:(NSString *)value hash:(NSString *)hash sats:(NSString *)sats resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end
#endif
