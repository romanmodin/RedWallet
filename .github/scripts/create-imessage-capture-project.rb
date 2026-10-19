# frozen_string_literal: true
# Separate UI-test runner; never modifies or rebuilds the qualified wallet.
require 'xcodeproj'
require 'fileutils'
root = File.expand_path(ARGV.fetch(0))
FileUtils.mkdir_p(root)
project = Xcodeproj::Project.new(File.join(root, 'StickerCapture.xcodeproj'))
target = project.new_target(:ui_test_bundle, 'StickerCapture', :ios, '16.0')
target.build_configurations.each do |config|
  config.build_settings.merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.romanmodin.redwallet.capturetests',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'SWIFT_VERSION' => '5.0',
    'CODE_SIGNING_ALLOWED' => 'NO',
    'TARGETED_DEVICE_FAMILY' => '1,2',
    'SUPPORTED_PLATFORMS' => 'iphonesimulator',
    'SDKROOT' => 'iphonesimulator'
  )
end
source = project.main_group.new_file(File.expand_path('imessage-capture.swift', __dir__))
target.source_build_phase.add_file_reference(source)
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.save_as(project.path, 'StickerCapture', true)
