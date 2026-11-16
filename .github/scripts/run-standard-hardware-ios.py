#!/usr/bin/env python3
"""One bounded simulator attempt; reuses tested process-group cleanup."""
import importlib.util
import os
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location("native_stage", Path(__file__).with_name("run-native-ios-stage.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

def command(_format):
    return [
        "npx", "detox", "test", "-c", "ios.release",
        "tests/e2e/standard-hardware-native.spec.ts", "--runTestsByPath",
        "--record-videos", "failing", "--record-logs", "failing",
        "--take-screenshots", "failing", "--headless", "--retries", "0", "--reuse",
        "--debug-synchronization", "0",
        "--artifacts-location", "artifacts/standard-hardware-native/detox",
    ]

if __name__ == "__main__":
    if os.environ.get("REDWALLET_STANDARD_NATIVE") != "1":
        sys.exit("Explicit standard-hardware simulator qualification required")
    sys.exit(runner.run_formats(command, os.environ, timeout_seconds=18 * 60))
