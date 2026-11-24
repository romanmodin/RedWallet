import unittest
from unittest.mock import patch

from internal_access import APP_ID, BUNDLE, GROUP, GROUP_NAME, main, verify_group


def resource(attrs):
    return {"attributes": attrs}


class AccessTests(unittest.TestCase):
    def members(self, group=None, testers=None):
        group = {"name": GROUP_NAME, "isInternalGroup": True, "hasAccessToAllBuilds": False,
                 "publicLinkEnabled": False, **(group or {})}
        replies = [
            {"data": {"id": APP_ID, "attributes": {"bundleId": BUNDLE}}},
            {"data": [{"id": GROUP, "attributes": group}]},
            {"data": testers if testers is not None else [resource({"email": "owner@example.invalid"})]},
            {"data": [resource({"roles": ["ACCOUNT_HOLDER"], "firstName": "Roman", "lastName": "Winter",
                                "username": "owner@example.invalid"})]}]
        return lambda path: replies.pop(0)

    def test_private_sole_holder(self):
        verify_group(self.members())
        for unsafe in ({"publicLinkEnabled": True}, {"hasAccessToAllBuilds": True}, {"isInternalGroup": False}):
            with self.subTest(unsafe=unsafe), self.assertRaises(ValueError):
                verify_group(self.members(group=unsafe))
        for people in ([], [resource({"email": "another@example.invalid"})], [resource({}), resource({})]):
            with self.assertRaises(ValueError):
                verify_group(self.members(testers=people))

    def test_unrestricted_build_is_never_assigned(self):
        build = {"processing": "VALID", "audience": "APP_STORE_ELIGIBLE", "assigned": False}
        with patch("internal_access.verify_group"), patch("internal_access.read_build", return_value=build), \
             patch("internal_access.add_group") as add, self.assertRaisesRegex(ValueError, "internal-only"):
            main()
        add.assert_not_called()

    def test_recheck_membership_before_assignment(self):
        build = {"id": "build", "processing": "VALID", "audience": "INTERNAL_ONLY", "assigned": False,
                 "internalState": "READY_FOR_BETA_TESTING"}
        with patch("internal_access.verify_group", side_effect=[None, ValueError("membership changed")]), \
             patch("internal_access.read_build", return_value=build), patch("internal_access.add_group") as add, \
             self.assertRaisesRegex(ValueError, "membership changed"):
            main()
        add.assert_not_called()
