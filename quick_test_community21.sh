#!/bin/bash
# Quick performance test for community 21

echo "=========================================="
echo "Testing Community 21 Performance"
echo "=========================================="
echo ""

URL="https://www.c-point.co/community_feed_react/21"

echo "Running 5 requests to measure cache performance..."
echo ""

for i in {1..5}; do
    echo "Request $i:"
    curl -s -w "   Time: %{time_total}s (%{size_download} bytes)\n\n" -o /dev/null "$URL"
    sleep 0.2
done

echo ""
echo "=========================================="
echo "Note: First request is typically slower (cache miss)"
echo "Subsequent requests should be much faster (cache hits)"
echo "=========================================="
