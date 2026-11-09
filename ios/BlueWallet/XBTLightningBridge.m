#import <TargetConditionals.h>
#if TARGET_OS_IOS && !TARGET_OS_MACCATALYST
#import <React/RCTBridgeModule.h>
@interface RCT_EXTERN_MODULE(XBTLightningBridge, NSObject)
RCT_EXTERN_METHOD(run:(NSString *)action peer:(NSString *)peer resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(invoice:(NSString *)operation value:(NSString *)value hash:(NSString *)hash sats:(NSString *)sats resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(recovery:(NSString *)operation phrase:(NSString *)phrase source:(NSString *)source resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(manage:(NSString *)operation value:(NSString *)value sats:(NSString *)sats feeRate:(NSString *)feeRate resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(splice:(NSString *)action value:(NSString *)value resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(peer:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(network:(NSString *)action value:(NSString *)value resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(watchtower:(NSString *)action value:(NSString *)value resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(wallet:(NSString *)action value:(NSString *)value resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(payInvoice:(NSString *)invoice hash:(NSString *)hash sats:(NSString *)sats feeLimit:(NSString *)feeLimit resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end
#endif
