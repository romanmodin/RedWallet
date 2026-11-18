#import <TargetConditionals.h>
#import <UIKit/UIKit.h>

#if !TARGET_OS_SIMULATOR
#error This regression fixture runs only in a disposable simulator.
#endif

// Link to the same Fabric class as the packaged simulator app. The fixture uses
// only UIKit views and never starts the React application or its native modules.
@interface RCTViewComponentView : UIView
- (void)mountChildComponentView:(UIView *)child index:(NSInteger)index;
- (void)unmountChildComponentView:(UIView *)child index:(NSInteger)index;
@end

static NSDictionary *exercise(NSInteger count, NSInteger actual, NSInteger requested)
{
  NSMutableDictionary *result = [@{@"count": @(count), @"actual": @(actual),
                                    @"requested": @(requested), @"passed": @NO} mutableCopy];
  @try {
    RCTViewComponentView *parent = [RCTViewComponentView new];
    NSMutableArray<UIView *> *siblings = [NSMutableArray array];
    for (NSInteger i = 0; i < count; ++i) {
      UIView *child = [RCTViewComponentView new];
      child.tag = i + 1;
      [parent mountChildComponentView:child index:i];
      [siblings addObject:child];
    }
    UIView *child = siblings[actual];
    UIView *container = child.superview;
    if (container != nil && [container.subviews isEqualToArray:siblings]) {
      [siblings removeObjectAtIndex:actual];
      [parent unmountChildComponentView:child index:requested];
      // Box as a Foundation boolean so the JSON report contains true or false.
      BOOL removedOnlyTarget = child.superview == nil && [container.subviews isEqualToArray:siblings];
      result[@"passed"] = [NSNumber numberWithBool:removedOnlyTarget];
    }
  } @catch (NSException *exception) {
    result[@"exception"] = exception.name;
  }
  return result;
}

@interface FabricFixtureDelegate : UIResponder <UIApplicationDelegate>
@end

@implementation FabricFixtureDelegate
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options
{
  NSArray *cases = @[exercise(4, 3, 4), exercise(22, 21, 22),
                     exercise(4, 1, -1), exercise(4, 2, 2), exercise(4, 1, 3)];
  NSData *data = [NSJSONSerialization dataWithJSONObject:cases options:0 error:nil];
  NSString *path = [NSTemporaryDirectory() stringByAppendingPathComponent:@"fabric-unmount.json"];
  [data writeToFile:path atomically:YES];
  return YES;
}
@end

int main(int argc, char **argv)
{
  @autoreleasepool {
    return UIApplicationMain(argc, argv, nil, NSStringFromClass([FabricFixtureDelegate class]));
  }
}
