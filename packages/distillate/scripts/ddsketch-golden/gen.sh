#!/bin/sh
# Regenerates the DDSketch golden mapping and protobuf fixtures in
# tests/fixtures/ddsketch/
# from pinned reference implementations. CI never runs this.
#
# sketches-go runs as amd64 on purpose. On arm64 the Go compiler fuses
# `log * multiplier + offset` into one FMA instruction, so values on a bin
# boundary land one index over. amd64 Go never fuses, and neither does JS, so
# amd64 is the binning the JS mappings are held to. Needs Go, a JDK and curl;
# on Apple silicon the amd64 binary runs under Rosetta.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out="$here/../../tests/fixtures/ddsketch"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

(cd "$here/go" && GOARCH=amd64 go run .) > "$out/mappings.go.json"
(cd "$here/go" && GOARCH=amd64 go run . protobuf) > "$out/protobuf.go.json"

jar="$tmp/sketches-java.jar"
curl -fsSL -o "$jar" https://repo1.maven.org/maven2/com/datadoghq/sketches-java/0.8.3/sketches-java-0.8.3.jar
javac -d "$tmp" -cp "$jar" "$here/java/Gen.java"
java -cp "$jar:$tmp" Gen > "$out/mappings.java.json"
