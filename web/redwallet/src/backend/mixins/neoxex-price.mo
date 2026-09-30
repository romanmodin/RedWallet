/// Display-only public market feed. Fixed URL; no wallet data or credentials.
import Blob "mo:core/Blob";
import Time "mo:core/Time";
import Call "mo:ic/Call";
import IC "mo:ic/Types";

mixin () {
  // Independent from wallet RPC quotas. Reserve before awaiting. Failed calls
  // are also throttled; upgrades may clear this transient display-only cache.
  transient var priceAttempt : Int = -300_000_000_000;
  transient var priceBusy = false;
  transient var priceDay : Int = 0;
  transient var priceCalls : Nat = 0;
  transient var priceResult : { #ok : Text; #err : Text } = #err("NeoxEX price unavailable");

  public query func transformNeoxexResponse(args : { context : Blob; response : IC.HttpRequestResult }) : async IC.HttpRequestResult {
    { status = args.response.status; body = args.response.body; headers = [] };
  };

  public shared func getNeoxexPrice() : async { #ok : Text; #err : Text } {
    let now = Time.now();
    if (priceBusy or now - priceAttempt < 300_000_000_000) return priceResult;
    let day = now / 86_400_000_000_000;
    if (priceDay != day) { priceDay := day; priceCalls := 0 };
    if (priceCalls >= 300) return #err("NeoxEX price refresh limit reached; last saved quote is retained");
    priceCalls += 1;
    priceAttempt := now;
    priceBusy := true;
    let response = try {
      await Call.httpRequest({
        url = "https://neoxa.exchange/api/exchange/trades/BTCB2_USDC?limit=1";
        method = #get;
        max_response_bytes = ?16_384;
        body = null;
        headers = [{ name = "accept"; value = "application/json" }];
        transform = ?{ function = transformNeoxexResponse; context = [].toBlob() };
        is_replicated = ?false;
      });
    } catch (_) {
      priceBusy := false;
      priceResult := #err("NeoxEX price is temporarily unavailable");
      return priceResult;
    };
    priceBusy := false;
    // Public, untrusted display data. The client validates the exact pair,
    // price, trade ID and strict UTC execution time before using or saving it.
    priceResult := if (response.status == 200 and response.body.size() <= 16_384) {
      switch (response.body.decodeUtf8()) {
        case (?body) #ok(body);
        case null #err("NeoxEX returned invalid price data");
      };
    } else #err("NeoxEX price is temporarily unavailable");
    priceResult;
  };
};
