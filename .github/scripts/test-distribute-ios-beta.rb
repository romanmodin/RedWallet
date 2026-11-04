# frozen_string_literal: true
# Offline checks: no Apple credentials, requests, or tester messages.
require 'tmpdir'
require_relative 'distribute-ios-beta'

class FixtureBetaRelease < RedWalletBetaRelease
  attr_reader :writes, :assigned
  attr_accessor :wrong_app, :wrong_group, :wrong_build, :expired, :compliance, :review_state, :existing, :external_state, :internal_state
  def initialize(notes_path:, receipt_path:)
    super(key_path: nil, notes_path: notes_path, receipt_path: receipt_path, token: Object.new)
    @writes = []; @assigned = []; @compliance = false; @review_state = 'WAITING_FOR_REVIEW'
  end
  def sleep(_seconds); end
  def api(method, path, query = {}, payload: nil)
    # Apple OpenAPI exposes only POST/DELETE on the build-to-group relationship.
    raise 'Unsupported Apple group relationship GET' if method == 'GET' && path.end_with?('/relationships/betaGroups')
    @writes << [method, path, payload] if method != 'GET'
    if path == "/v1/apps/#{APP_ID}"
      return { 'data' => { 'attributes' => { 'bundleId' => wrong_app ? 'wrong.app' : BUNDLE_ID } } }
    end
    group = GROUPS.find { |g| path == "/v1/betaGroups/#{g[:id]}" }
    if group
      return { 'data' => { 'attributes' => { 'name' => wrong_group ? 'Wrong group' : group[:name],
                 'isInternalGroup' => group[:internal] },
                 'relationships' => { 'app' => { 'data' => { 'id' => APP_ID } } } } }
    end
    if path == '/v1/builds'
      return { 'data' => [{ 'id' => 'fixture-build', 'attributes' => { 'processingState' => 'VALID',
          'version' => wrong_build ? '1' : BUILD, 'expired' => !!expired, 'usesNonExemptEncryption' => compliance } }],
          'included' => [{ 'type' => 'preReleaseVersions', 'attributes' => { 'version' => VERSION, 'platform' => 'IOS' } }] }
    end
    if path.end_with?('/betaBuildLocalizations')
      return { 'data' => [{ 'id' => 'fixture-locale', 'attributes' => { 'locale' => 'en-US' } }] }
    end
    return {} if path == '/v1/betaBuildLocalizations/fixture-locale' && method == 'PATCH'
    if path.end_with?('/relationships/betaGroups')
      assigned.concat(payload.fetch(:data).map { |g| g.fetch(:id) })
      return {}
    end
    if path == '/v1/betaAppReviewSubmissions'
      return { 'data' => review_state ? [{ 'attributes' => { 'betaReviewState' => review_state } }] : [] } if method == 'GET'
      @review_state = 'WAITING_FOR_REVIEW'
      return {}
    end
    if path == '/v1/builds/fixture-build'
      ids = existing ? GROUPS.map { |g| g[:id] } : assigned
      external = external_state || (review_state == 'APPROVED' ? 'IN_BETA_TESTING' :
                                   review_state.nil? ? 'READY_FOR_BETA_SUBMISSION' : 'WAITING_FOR_BETA_REVIEW')
      return { 'data' => { 'attributes' => { 'processingState' => 'VALID' } }, 'included' =>
        [{ 'type' => 'buildBetaDetails', 'attributes' => { 'internalBuildState' => internal_state || 'IN_BETA_TESTING',
              'externalBuildState' => external } },
         { 'type' => 'betaAppReviewSubmissions', 'attributes' => { 'betaReviewState' => review_state } }] +
         ids.map { |id| { 'type' => 'betaGroups', 'id' => id } } }
    end
    raise "Unexpected fixture request #{method} #{path}"
  end
end

def check(value, message)
  raise message unless value
end

Dir.mktmpdir('redwallet-beta-fixtures') do |dir|
  Dir.chdir(dir) do
    ENV['UPLOAD_RUN_ID'] = 'fixture-upload'
    File.write('notes.txt', 'Taproot fixture notes')
    File.write('receipt.json', JSON.generate({ ipaSha256: 'fixture', publicSourceCommit: 'fixture',
                                             sourceCommit: 'fixture', orchestrationCommit: 'fixture' }))
    factory = -> { FixtureBetaRelease.new(notes_path: 'notes.txt', receipt_path: 'receipt.json') }
    report = -> { JSON.parse(File.read('testflight-beta-verification.json')) }
    [:wrong_app, :wrong_group, :wrong_build, :expired].each do |failure|
      release = factory.call
      release.public_send("#{failure}=", true)
      begin
        release.run
        raise 'Expected identity/expiry rejection'
      rescue BetaReleaseError
        check(release.writes.empty?, 'Identity failure mutated Apple state')
        check(report.call['status'] == 'BLOCKED', 'Rejection must be reported')
      end
    end
    release = factory.call; release.compliance = nil
    begin
      release.run; raise 'Expected compliance rejection'
    rescue BetaReleaseError
      check(release.writes.empty?, 'Unknown compliance mutated Apple state')
    end
    release = factory.call; release.review_state = nil; release.run
    check(RedWalletBetaRelease::GROUPS.length == 1 && RedWalletBetaRelease::GROUPS.first[:internal], 'Regtest must be internal only')
    check(release.assigned == [RedWalletBetaRelease::GROUPS.first[:id]], 'Wrong internal tester assignment')
    check(release.writes.none? { |w| w[1] == '/v1/betaAppReviewSubmissions' }, 'Regtest must never submit external beta review')
    check(report.call['status'] == 'AVAILABLE_TO_INTERNAL_TESTERS', 'Internal availability was not recognized')
    release = factory.call; release.existing = true; release.run
    check(release.writes.all? { |w| w[0] == 'PATCH' }, 'Idempotent run reassigned groups or submitted review')
    check(report.call['groups'].all? { |g| g['assigned'] && g['internal'] }, 'Receipt lost internal group confirmation')
    release = factory.call; release.internal_state = 'READY_FOR_BETA_TESTING'; release.run
    check(report.call['status'] == 'TESTER_STATE_PROPAGATION_PENDING', 'Ready state falsely claims active availability')
    release = factory.call; release.review_state = 'REJECTED'; release.run
    check(report.call['status'] == 'AVAILABLE_TO_INTERNAL_TESTERS', 'External review must not govern this internal-only release')
    check(release.writes.none? { |w| w[1] == '/v1/betaAppReviewSubmissions' }, 'External review was mutated')
    puts 'PASS: identity, compliance, internal-only assignment, idempotency, and availability checks'
  end
end
