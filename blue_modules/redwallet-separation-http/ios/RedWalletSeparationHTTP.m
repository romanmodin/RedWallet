#import <React/RCTBridgeModule.h>
@interface RCT_EXTERN_MODULE(RedWalletSeparationHTTP, NSObject)
RCT_EXTERN_METHOD(get:(NSString *)identifier url:(NSString *)url limit:(double)limit resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(cancel:(NSString *)identifier)
@end
