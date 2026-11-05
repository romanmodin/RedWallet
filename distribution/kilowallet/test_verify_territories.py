import copy
import unittest
from verify_territories import APP, BUNDLE, APP_PATH, check, route

class TerritoryTest(unittest.TestCase):
    def setUp(self):
        self.app = {"data": {"type": "apps", "id": APP, "attributes": {"bundleId": BUNDLE}}}
        self.a = {"data": {"type": "appAvailabilities", "id": "available-1", "attributes": {"availableInNewTerritories": False}}}
        self.page = {"data": [self.row("USA", True), self.row("FRA", False)]}
    def row(self, country, active):
        return {"type": "territoryAvailabilities", "attributes": {"available": active},
                "relationships": {"territory": {"data": {"type": "territories", "id": country}}}}
    def client(self, path):
        route(path)
        if path == APP_PATH: return self.app
        if path == APP_PATH + "/appAvailabilityV2": return self.a
        return self.page
    def test_us_only(self):
        self.assertEqual(["USA"], check(self.client)["territories"])
    def test_france_or_any_other_country_blocks(self):
        for country in ("FRA", "CAN"):
            self.page["data"].append(self.row(country, True))
            with self.assertRaises(ValueError): check(self.client)
            self.page["data"].pop()
    def test_no_available_territory_blocks(self):
        self.page["data"] = [self.row("USA", False)]
        with self.assertRaises(ValueError): check(self.client)
    def test_automatic_future_expansion_blocks(self):
        for value in (True, None, "false", 0):
            self.a["data"]["attributes"]["availableInNewTerritories"] = value
            with self.assertRaises(ValueError): check(self.client)
    def test_wrong_app_blocks(self):
        self.app["data"]["id"] = "other"
        with self.assertRaises(ValueError): check(self.client)
    def test_duplicate_or_missing_territory_boolean_blocks(self):
        for page in ([self.row("USA", True)] * 2, [self.row("USA", None)], [self.row("USA", "true")]):
            self.page["data"] = page
            with self.assertRaises(ValueError): check(self.client)
    def test_incomplete_collection_blocks(self):
        self.page["data"] = None
        with self.assertRaises(ValueError): check(self.client)
    def test_cyclic_next_blocks(self):
        self.page = {"data": [], "links": {"next": "/v2/appAvailabilities/available-1/territoryAvailabilities?include=territory&limit=200"}}
        with self.assertRaises(ValueError): check(self.client)
    def test_pagination_reads_all_before_approving(self):
        first = self.page; first["links"] = {"next": "https://api.appstoreconnect.apple.com/v2/appAvailabilities/available-1/territoryAvailabilities?cursor=2"}
        def read(path):
            if "cursor=2" in path: return {"data": [self.row("CAN", True)]}
            return self.client(path)
        with self.assertRaises(ValueError): check(read)
    def test_good_pagination(self):
        self.page["links"] = {"next": "/v2/appAvailabilities/available-1/territoryAvailabilities?cursor=2"}
        def read(path):
            if "cursor=2" in path: return {"data": [self.row("CAN", False)]}
            return self.client(path)
        self.assertEqual(3, check(read)["checkedTerritories"])
    def test_foreign_or_changed_next_resource_blocks(self):
        for nxt in ("https://example.invalid/x", "/v2/appAvailabilities/other/territoryAvailabilities", "https://api.appstoreconnect.apple.com/v2/appAvailabilities/available-1/territoryAvailabilities#secret"):
            self.page["links"] = {"next": nxt}
            with self.assertRaises(ValueError): check(self.client)
    def test_route_rejects_mutation_or_unrelated_resources(self):
        for path in ("/v1/profiles", "/v1/apps/other", "https://api.appstoreconnect.apple.com" + APP_PATH, APP_PATH + "#x"):
            with self.assertRaises(ValueError): route(path)

if __name__ == "__main__": unittest.main()
