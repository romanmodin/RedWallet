# frozen_string_literal: true
# Assign only the verified Taproot build to the two existing RedWallet beta groups.
require 'json'
require 'net/http'
require 'openssl'
require 'spaceship'
require 'time'
require 'uri'

class BetaReleaseError < StandardError; end

class RedWalletBetaRelease
  APP_ID = '6817118871'
  BUNDLE_ID = 'com.romanmodin.redwallet'
  BUILD = '1791098754'
  VERSION = '8.0.1'
  GROUPS = [
    { id: '0bc2722a-48b6-4520-871d-dd5a4a8988cb', name: 'Roman iPhone Testing', internal: true },
    { id: '463ff340-3283-4f17-949d-39c7aa929da2', name: 'RedWallet Early Testers', internal: false }
  ].freeze

  def initialize(key_path:, notes_path:, receipt_path:, token: nil)
    begin
      @token = token || Spaceship::ConnectAPI::Token.from_json_file(key_path)
    rescue StandardError
      raise BetaReleaseError, 'Existing Apple API authentication configuration is invalid'
    end
    @notes = File.read(notes_path, encoding: 'UTF-8')
    raise BetaReleaseError, 'Invalid beta release notes' unless @notes.valid_encoding? && @notes.bytesize.between?(1, 4000)
    @receipt = JSON.parse(File.read(receipt_path))
    @report = { appId: APP_ID, bundleId: BUNDLE_ID, version: VERSION, build: BUILD,
                ipaSha256: @receipt.fetch('ipaSha256'),
                publicSourceCommit: @receipt.fetch('publicSourceCommit'),
                sourceCommit: @receipt.fetch('sourceCommit'),
                orchestrationCommit: @receipt.fetch('orchestrationCommit'),
                uploadRunId: ENV.fetch('UPLOAD_RUN_ID'), verifiedAt: Time.now.utc.iso8601 }
  end

  def api(method, path, query = {}, payload: nil)
    raise BetaReleaseError, 'Unexpected Apple API path' unless path.start_with?('/v1/') && !path.include?('://')
    @token.refresh! if @token.expired?
    uri = URI::HTTPS.build(host: 'api.appstoreconnect.apple.com', path: path,
                          query: query.empty? ? nil : URI.encode_www_form(query))
    request = { 'GET' => Net::HTTP::Get, 'POST' => Net::HTTP::Post, 'PATCH' => Net::HTTP::Patch }.fetch(method).new(uri)
    request['Authorization'] = "Bearer #{@token.text}"
    request['Accept'] = 'application/json'
    if payload
      request['Content-Type'] = 'application/json'
      request.body = JSON.generate(payload)
    end
    response = Net::HTTP.start(uri.host, uri.port, use_ssl: true,
                              verify_mode: OpenSSL::SSL::VERIFY_PEER, open_timeout: 30, read_timeout: 60) { |http| http.request(request) }
    unless response.is_a?(Net::HTTPSuccess)
      codes = begin
        JSON.parse(response.body).fetch('errors', []).map { |error| error['code'].to_s.gsub(/[^A-Z0-9_.-]/, '') }
      rescue StandardError
        []
      end
      raise BetaReleaseError, "Apple API request failed: HTTP #{response.code}, codes #{codes.join(',')}"
    end
    response.body.to_s.empty? ? {} : JSON.parse(response.body)
  end

  def build_info(id)
    api('GET', "/v1/builds/#{id}", { 'include' => 'buildBetaDetail,betaAppReviewSubmission,betaGroups,preReleaseVersion' })
  end

  def add_group(build_id, group_id)
    ids = api('GET', "/v1/builds/#{build_id}/relationships/betaGroups").fetch('data').map { |group| group.fetch('id') }
    return if ids.include?(group_id)
    api('POST', "/v1/builds/#{build_id}/relationships/betaGroups",
        payload: { data: [{ type: 'betaGroups', id: group_id }] })
  end

  def save_report(status, info = nil)
    @report[:status] = status
    @report[:verifiedAt] = Time.now.utc.iso8601
    if info
      @report[:processingState] = info.fetch('data').fetch('attributes')['processingState']
      included = info.fetch('included', [])
      beta = included.find { |item| item['type'] == 'buildBetaDetails' }
      review = included.find { |item| item['type'] == 'betaAppReviewSubmissions' }
      @report[:internalBuildState] = beta&.dig('attributes', 'internalBuildState')
      @report[:externalBuildState] = beta&.dig('attributes', 'externalBuildState')
      @report[:betaReviewState] = review&.dig('attributes', 'betaReviewState')
      assigned = included.select { |item| item['type'] == 'betaGroups' }.map { |item| item['id'] }
      @report[:groups] = GROUPS.map { |group| { id: group[:id], name: group[:name], internal: group[:internal], assigned: assigned.include?(group[:id]) } }
    end
    File.write('testflight-beta-verification.json', JSON.pretty_generate(@report) + "\n")
    puts JSON.generate(@report)
  end

  def run
    app = api('GET', "/v1/apps/#{APP_ID}").fetch('data')
    raise BetaReleaseError, 'Wrong Apple app identity' unless app.dig('attributes', 'bundleId') == BUNDLE_ID
    GROUPS.each do |expected|
      group = api('GET', "/v1/betaGroups/#{expected[:id]}", { 'include' => 'app' }).fetch('data')
      valid = group.dig('attributes', 'name') == expected[:name] &&
              group.dig('attributes', 'isInternalGroup') == expected[:internal] &&
              group.dig('relationships', 'app', 'data', 'id') == APP_ID
      raise BetaReleaseError, 'Existing tester group identity does not match' unless valid
    end

    build = nil
    40.times do
      response = api('GET', '/v1/builds', { 'filter[app]' => APP_ID, 'filter[version]' => BUILD,
                                         'include' => 'preReleaseVersion', 'limit' => '10' })
      matches = response.fetch('data')
      raise BetaReleaseError, 'Ambiguous Apple build identity' if matches.length > 1
      build = matches.first
      if build
        attributes = build.fetch('attributes')
        raise BetaReleaseError, 'Wrong Apple build number' unless attributes['version'] == BUILD
        raise BetaReleaseError, 'Build is expired or rejected by Apple processing' if attributes['expired'] ||
          %w[FAILED INVALID].include?(attributes['processingState'])
        if attributes['processingState'] == 'VALID'
          release = response.fetch('included', []).find { |item| item['type'] == 'preReleaseVersions' }
          raise BetaReleaseError, 'Wrong iOS marketing version' unless release&.dig('attributes', 'version') == VERSION &&
            release&.dig('attributes', 'platform') == 'IOS'
          break
        end
      end
      puts 'Waiting for Apple processing of the exact verified build'
      sleep 30
    end
    unless build && build.dig('attributes', 'processingState') == 'VALID'
      save_report('APPLE_PROCESSING_PENDING')
      return
    end
    raise BetaReleaseError, 'Apple encryption compliance requires attention' unless build.dig('attributes', 'usesNonExemptEncryption') == false
    build_id = build.fetch('id')
    @report[:appleBuildId] = build_id

    localizations = api('GET', "/v1/builds/#{build_id}/betaBuildLocalizations").fetch('data')
    english = localizations.find { |localization| localization.dig('attributes', 'locale') == 'en-US' }
    if english
      api('PATCH', "/v1/betaBuildLocalizations/#{english.fetch('id')}",
          payload: { data: { type: 'betaBuildLocalizations', id: english.fetch('id'), attributes: { whatsNew: @notes } } })
    else
      api('POST', '/v1/betaBuildLocalizations',
          payload: { data: { type: 'betaBuildLocalizations', attributes: { locale: 'en-US', whatsNew: @notes },
                             relationships: { build: { data: { type: 'builds', id: build_id } } } } })
    end
    @report[:betaNotesUpdated] = true
    add_group(build_id, GROUPS.first.fetch(:id))
    review = api('GET', '/v1/betaAppReviewSubmissions', { 'filter[build]' => build_id }).fetch('data').first
    raise BetaReleaseError, 'Beta review rejected; owner follow-up required' if review&.dig('attributes', 'betaReviewState') == 'REJECTED'
    unless review
      api('POST', '/v1/betaAppReviewSubmissions',
          payload: { data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: build_id } } } } })
      @report[:betaReviewSubmitted] = true
    end
    add_group(build_id, GROUPS.last.fetch(:id))

    info = nil
    6.times do
      info = build_info(build_id)
      included = info.fetch('included', [])
      beta = included.find { |item| item['type'] == 'buildBetaDetails' }
      review = included.find { |item| item['type'] == 'betaAppReviewSubmissions' }
      break if beta&.dig('attributes', 'internalBuildState') == 'IN_BETA_TESTING' &&
        (beta&.dig('attributes', 'externalBuildState') == 'IN_BETA_TESTING' ||
         %w[WAITING_FOR_REVIEW IN_REVIEW].include?(review&.dig('attributes', 'betaReviewState')))
      sleep 10
    end
    groups = info.fetch('included', []).select { |item| item['type'] == 'betaGroups' }.map { |item| item['id'] }
    raise BetaReleaseError, 'Tester group assignment was not confirmed' unless GROUPS.all? { |group| groups.include?(group[:id]) }
    beta = info.fetch('included', []).find { |item| item['type'] == 'buildBetaDetails' }
    review = info.fetch('included', []).find { |item| item['type'] == 'betaAppReviewSubmissions' }
    status = if beta&.dig('attributes', 'internalBuildState') == 'IN_BETA_TESTING' &&
                beta&.dig('attributes', 'externalBuildState') == 'IN_BETA_TESTING'
               'AVAILABLE_TO_TESTERS'
             elsif %w[WAITING_FOR_REVIEW IN_REVIEW].include?(review&.dig('attributes', 'betaReviewState'))
               'BETA_REVIEW_PENDING'
             else
               'TESTER_STATE_PROPAGATION_PENDING'
             end
    save_report(status, info)
  rescue BetaReleaseError => error
    @report[:error] = error.message
    save_report('BLOCKED')
    raise
  end
end

if $PROGRAM_NAME == __FILE__
 begin
  RedWalletBetaRelease.new(key_path: ENV.fetch('APPLE_API_KEY_PATH'),
                          notes_path: ENV.fetch('BETA_NOTES_PATH'),
                          receipt_path: ENV.fetch('UPLOAD_RECEIPT_PATH')).run
rescue BetaReleaseError => error
  warn error.message
  exit 1
rescue StandardError => error
  warn "Beta release failed (#{error.class}); credential values are never printed"
  exit 1
end

end
