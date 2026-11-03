# Run in a disposable checkout to build the on-device Lightning test variant.
# Its prebuilt engine requires iOS 16. The shipping app still supports iOS 15.6.
require 'xcodeproj'
project = Xcodeproj::Project.open('ios/BlueWallet.xcodeproj')
target = project.targets.find { |t| t.name == 'BlueWallet' } or abort 'Missing RedWallet app target'
objects = Xcodeproj::Project::Object
package = project.root_object.package_references.find { |p| p.respond_to?(:relative_path) && p.relative_path == 'XBTLightning' }
unless package
  package = project.new(objects::XCLocalSwiftPackageReference)
  package.relative_path = 'XBTLightning'
  project.root_object.package_references << package
end
product = target.package_product_dependencies.find { |p| p.product_name == 'XBTLightning' }
unless product
  product = project.new(objects::XCSwiftPackageProductDependency)
  product.product_name = 'XBTLightning'
  product.package = package
  target.package_product_dependencies << product
  link = project.new(objects::PBXBuildFile)
  link.product_ref = product
  target.frameworks_build_phase.files << link
end
group = project.main_group.find_subpath('RedWallet Lightning', true)
group.path = nil
%w[XBTLightningBridge.m XBTLightningBridge.swift].each do |name|
  path = 'BlueWallet/' + name
  file = group.files.find { |f| f.path == path } || group.new_file(path)
  target.add_file_references([file]) unless target.source_build_phase.files_references.include?(file)
end
target.build_configurations.each do |configuration|
  configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '16.0'
end
project.save
