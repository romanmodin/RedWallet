# Run the real Keychain and LND under a signed iOS application. A hostless
# Swift package test process has no application-identifier for Keychain.
require 'xcodeproj'
require 'fileutils'
root = File.expand_path(ARGV.fetch(0))
FileUtils.mkdir_p(root)
restore = ENV['REGTEST_RESTORE'] == '1'
namespace = restore ? 'org.redwallet.restorefixture.' : 'org.redwallet.sandbox.'
project = Xcodeproj::Project.new(File.join(root, 'RegtestHost.xcodeproj'))
host = project.new_target(:application, 'RegtestHost', :ios, '16.0')
tests = project.new_target(:unit_test_bundle, 'RegtestHostTests', :ios, '16.0')
[host, tests].each do |target|
  target.build_configurations.each do |configuration|
    configuration.build_settings.merge!(
      'PRODUCT_BUNDLE_IDENTIFIER' => namespace + target.name,
      'GENERATE_INFOPLIST_FILE' => 'YES', 'SWIFT_VERSION' => '5.0',
      'SDKROOT' => 'iphonesimulator', 'SUPPORTED_PLATFORMS' => 'iphonesimulator',
      'TARGETED_DEVICE_FAMILY' => '1', 'CODE_SIGN_IDENTITY' => '-'
    )
  end
end
File.write(File.join(root, 'main.swift'), <<~SWIFT)
  import UIKit
  final class AppDelegate: UIResponder, UIApplicationDelegate {}
  UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
SWIFT
host.source_build_phase.add_file_reference(project.main_group.new_file('main.swift'))
entitlements = { 'application-identifier' => 'RWTESTRUN1.' + namespace + 'RegtestHost',
                 'keychain-access-groups' => ['RWTESTRUN1.' + namespace + 'RegtestHost'] }
Xcodeproj::Plist.write_to_path(entitlements, File.join(root, 'Host.entitlements'))
host.build_configurations.each { |c| c.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'Host.entitlements' }
tests.add_dependency(host)
tests.build_configurations.each do |c|
  c.build_settings['TEST_HOST'] = '$(BUILT_PRODUCTS_DIR)/RegtestHost.app/RegtestHost'
  c.build_settings['BUNDLE_LOADER'] = '$(TEST_HOST)'
  c.build_settings['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = '$(inherited) XBT_LND_ROUTED_TEST' if ENV['REGTEST_TIER'] == 'payments'
end
if ENV['XBT_PUBLIC_SMOKE'] == '1'
  tests.build_configurations.each do |c|
    c.build_settings['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = '$(inherited) XBT_LND_PUBLIC_SMOKE'
  end
end
objects = Xcodeproj::Project::Object
package = project.new(objects::XCLocalSwiftPackageReference)
package.relative_path = File.expand_path('ios/XBTLightning')
project.root_object.package_references << package
product = project.new(objects::XCSwiftPackageProductDependency)
product.package = package
product.product_name = 'XBTLightning'
tests.package_product_dependencies << product
link = project.new(objects::PBXBuildFile)
link.product_ref = product
tests.frameworks_build_phase.files << link
Dir.glob('ios/XBTLightning/Tests/XBTLightningTests/*.swift').sort.each do |path|
  tests.source_build_phase.add_file_reference(project.main_group.new_file(File.expand_path(path)))
end
if restore
  resources = %w[RestoreFixture.rwln RestoreIdentity.txt]
  resources << 'RestoreBalance.txt' if ENV['REGTEST_TIER'] == 'payments'
  resources.each do |name|
    tests.resources_build_phase.add_file_reference(project.main_group.new_file(name))
  end
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(host)
scheme.add_test_target(tests)
scheme.save_as(project.path, 'RegtestHost', true)
