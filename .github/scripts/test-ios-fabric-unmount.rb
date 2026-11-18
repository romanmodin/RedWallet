# frozen_string_literal: true

require 'json'
require 'open3'
require 'securerandom'
require 'timeout'
require 'xcodeproj'

def output(*command)
  text, status = Open3.capture2(*command)
  abort "Failed: #{command.join(' ')}" unless status.success?
  text.strip
end

def run!(*command)
  abort "Failed: #{command.join(' ')}" unless system(*command)
end

root = File.expand_path('../..', __dir__)
Dir.chdir(root)
project_file = 'ios/BlueWallet.xcodeproj/project.pbxproj'
original_project = File.binread(project_file)
product = 'ios/build/Build/Products/Release-iphonesimulator/BlueWallet.app'
simctl = %w[xcrun simctl]
device = nil
begin
  # The ordinary app has already been archived for Detox. Relink only on this
  # runner, with a UIKit entry point that owns no wallet or node.
  project = Xcodeproj::Project.open(File.dirname(project_file))
  target = project.targets.find { |candidate| candidate.name == 'BlueWallet' }
  sources = target.source_build_phase
  entry = sources.files.find { |f| f.file_ref&.real_path&.basename.to_s == 'AppDelegate.swift' }
  abort 'Expected the normal app entry point' unless entry
  entry.remove_from_project
  fixture = project.main_group.new_file(File.join(root, '.github/fixtures/FabricUnmount.m'))
  sources.add_file_reference(fixture)
  target.build_configurations.each { |c| c.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'org.redwallet.tests.fabric-unmount' }
  project.save
  run!('xcodebuild', '-quiet', '-workspace', 'ios/BlueWallet.xcworkspace', '-scheme', 'BlueWallet',
       '-configuration', 'Release', '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator',
       '-derivedDataPath', 'ios/build', 'CLANG_ENABLE_EXPLICIT_MODULES=NO', 'SWIFT_ENABLE_EXPLICIT_MODULES=NO', 'build')
  bundle_id = output('/usr/libexec/PlistBuddy', '-c', 'Print :CFBundleIdentifier', "#{product}/Info.plist")
  abort 'Expected the simulator fixture' unless bundle_id == 'org.redwallet.tests.fabric-unmount'

  runtimes = JSON.parse(output(*simctl, 'list', 'devices', 'available', '--json')).fetch('devices')
  phones = runtimes.filter_map do |runtime, available|
    version = runtime[/\.iOS-(\d+(?:-\d+)*)\z/, 1]
    phone = available.find { |d| d.fetch('deviceTypeIdentifier', '').include?('.iPhone-') }
    [Gem::Version.new(version.tr('-', '.')), runtime, phone['deviceTypeIdentifier']] if phone && version
  end
  abort 'No available iPhone runtime' if phones.empty?
  _, runtime, device_type = phones.max_by(&:first)
  device = output(*simctl, 'create', "Fabric-unmount-#{SecureRandom.hex(4)}", device_type, runtime)
  run!(*simctl, 'boot', device)
  run!(*simctl, 'bootstatus', device, '-b')
  run!(*simctl, 'install', device, product)
  run!(*simctl, 'launch', device, bundle_id)
  container = output(*simctl, 'get_app_container', device, bundle_id, 'data')
  report = File.join(container, 'tmp', 'fabric-unmount.json')
  Timeout.timeout(90) { sleep 1 until File.file?(report) }
  cases = JSON.parse(File.read(report))
  puts JSON.pretty_generate(cases)
  actual = cases.map { |c| c.values_at('count', 'actual', 'requested', 'passed') }
  expected = [[4, 3, 4, true], [22, 21, 22, true], [4, 1, -1, true], [4, 2, 2, true], [4, 1, 3, true]]
  abort 'Fabric removed the wrong view, changed siblings, or threw' unless actual == expected
ensure
  File.binwrite(project_file, original_project)
  if device
    system(*simctl, 'shutdown', device)
    system(*simctl, 'delete', device)
  end
end
