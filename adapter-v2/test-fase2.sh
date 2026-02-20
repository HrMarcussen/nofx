#!/bin/bash
# Test Runner for Phase 2
# Runs all Phase 2 tests and reports results

echo "========================================"
echo "  Trading Adapter V2 - Phase 2 Tests"
echo "========================================"
echo ""

PASSED=0
FAILED=0
TOTAL=0

# Function to run a test file
run_test() {
  local test_file=$1
  local test_name=$(basename "$test_file" .test.js)
  
  echo "Running: $test_name..."
  TOTAL=$((TOTAL + 1))
  
  if node "$test_file" > /tmp/test_output_$$.txt 2>&1; then
    echo "  ✅ PASSED"
    PASSED=$((PASSED + 1))
  else
    echo "  ❌ FAILED"
    cat /tmp/test_output_$$.txt
    FAILED=$((FAILED + 1))
  fi
  
  rm -f /tmp/test_output_$$.txt
  echo ""
}

# Phase 2 tests
run_test "test/data-buffer.test.js"
run_test "test/indicators.test.js"
run_test "test/escalation-handler.test.js"
run_test "test/risk-assessment.test.js"
run_test "test/integration-fase2.test.js"

# Also run Phase 1 tests to ensure backward compatibility
echo "========================================" 
echo "  Backward Compatibility (Phase 1)"
echo "========================================"
echo ""

run_test "test/signal-condenser.test.js"
run_test "test/rule-engine.test.js"
run_test "test/position-sizer.test.js"
run_test "test/integration.test.js"

# Summary
echo "========================================"
echo "  Test Summary"
echo "========================================"
echo ""
echo "Total tests:  $TOTAL"
echo "Passed:       $PASSED"
echo "Failed:       $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
  echo "✅ All tests passed!"
  exit 0
else
  echo "❌ $FAILED test(s) failed"
  exit 1
fi
