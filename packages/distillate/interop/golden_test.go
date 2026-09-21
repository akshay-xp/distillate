// Verifies the committed golden frames from Go, written against the
// serialization reference rather than the TypeScript, so agreement between two
// independent readers is proved instead of asserted.
package interop

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"os"
	"strings"
	"testing"
)

type entry struct {
	Name    string
	Kind    string
	Keys    []string
	Epsilon float64
	P       int
	Frame   string
}

type frame struct {
	typ, flags byte
	body       []byte
}

const (
	headerSize  = 16
	trailerSize = 4
	version     = 5
)

var le = binary.LittleEndian

// readFrame checks a frame in the order the reference gives: length, magic,
// version, declared body length, CRC, then the reserved header bits.
func readFrame(b []byte) (frame, error) {
	if len(b) < headerSize+trailerSize {
		return frame{}, fmt.Errorf("%d bytes is shorter than a frame", len(b))
	}
	if string(b[:4]) != "DSTL" {
		return frame{}, fmt.Errorf("magic %q, want DSTL", b[:4])
	}
	if b[4] != version {
		return frame{}, fmt.Errorf("version %d, want %d", b[4], version)
	}
	bodyLen := int(le.Uint32(b[8:]))
	if headerSize+bodyLen+trailerSize != len(b) {
		return frame{}, fmt.Errorf("body length %d disagrees with a %d-byte frame", bodyLen, len(b))
	}
	end := len(b) - trailerSize
	if got, want := le.Uint32(b[end:]), crc32.ChecksumIEEE(b[:end]); got != want {
		return frame{}, fmt.Errorf("CRC %08x, contents give %08x", got, want)
	}
	if b[6]&0xf0 != 0 || b[7] != 0 || le.Uint32(b[12:]) != 0 {
		return frame{}, fmt.Errorf("reserved header bits set")
	}
	return frame{typ: b[5], flags: b[6], body: b[headerSize:end]}, nil
}

func golden(t *testing.T) []entry {
	t.Helper()
	raw, err := os.ReadFile("../tests/fixtures/golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var entries []entry
	if err := json.Unmarshal(raw, &entries); err != nil {
		t.Fatal(err)
	}
	return entries
}

func frameOf(t *testing.T, e entry) []byte {
	t.Helper()
	b, err := base64.StdEncoding.DecodeString(e.Frame)
	if err != nil {
		t.Fatalf("%s: %v", e.Name, err)
	}
	return b
}

func find(t *testing.T, name string) entry {
	t.Helper()
	for _, e := range golden(t) {
		if e.Name == name {
			return e
		}
	}
	t.Fatalf("no golden entry %q", name)
	return entry{}
}

var typeOf = map[string]byte{"bloom": 1, "blocked": 2, "fuse8": 3, "fuse16": 4, "hll": 5}

func TestFrames(t *testing.T) {
	for _, e := range golden(t) {
		f, err := readFrame(frameOf(t, e))
		if e.Kind == "v2" {
			if err == nil || !strings.Contains(err.Error(), "version") {
				t.Errorf("%s: want a version error, got %v", e.Name, err)
			}
			continue
		}
		if err != nil {
			t.Errorf("%s: %v", e.Name, err)
			continue
		}
		if f.typ != typeOf[e.Kind] {
			t.Errorf("%s: type %d, want %d", e.Name, f.typ, typeOf[e.Kind])
		}
	}

	flipped := frameOf(t, find(t, "bloom"))
	flipped[16] ^= 0xff
	if _, err := readFrame(flipped); err == nil || !strings.Contains(err.Error(), "CRC") {
		t.Errorf("flipped body: want a CRC error, got %v", err)
	}

	whole := frameOf(t, find(t, "bloom"))
	if _, err := readFrame(whole[:len(whole)-1]); err == nil || !strings.Contains(err.Error(), "body length") {
		t.Errorf("short frame: want a body length error, got %v", err)
	}
}
