// Verifies the committed golden frames from Go, written against the
// serialization reference rather than the TypeScript, so agreement between two
// independent readers is proved instead of asserted.
package interop

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"math"
	"math/bits"
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
	Deletes []string
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

var typeOf = map[string]byte{"bloom": 1, "blocked": 2, "fuse8": 3, "fuse16": 4, "hll": 5, "scalable": 6, "cuckoo": 7, "countmin": 8}

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

// murmur3x86_128 is Austin Appleby's MurmurHash3_x86_128, the hash variant 0
// names. Little-endian block reads, four 32-bit lanes.
func murmur3x86_128(b []byte, seed uint32) [4]uint32 {
	const c1, c2, c3, c4 = 0x239b961b, 0xab0e9789, 0x38b34ae5, 0xa1e38b93
	h1, h2, h3, h4 := seed, seed, seed, seed
	n := len(b) / 16
	for i := 0; i < n; i++ {
		blk := b[i*16:]
		k1, k2, k3, k4 := le.Uint32(blk), le.Uint32(blk[4:]), le.Uint32(blk[8:]), le.Uint32(blk[12:])

		k1 *= c1
		k1 = bits.RotateLeft32(k1, 15)
		k1 *= c2
		h1 ^= k1
		h1 = bits.RotateLeft32(h1, 19)
		h1 += h2
		h1 = h1*5 + 0x561ccd1b

		k2 *= c2
		k2 = bits.RotateLeft32(k2, 16)
		k2 *= c3
		h2 ^= k2
		h2 = bits.RotateLeft32(h2, 17)
		h2 += h3
		h2 = h2*5 + 0x0bcaa747

		k3 *= c3
		k3 = bits.RotateLeft32(k3, 17)
		k3 *= c4
		h3 ^= k3
		h3 = bits.RotateLeft32(h3, 15)
		h3 += h4
		h3 = h3*5 + 0x96cd1c35

		k4 *= c4
		k4 = bits.RotateLeft32(k4, 18)
		k4 *= c1
		h4 ^= k4
		h4 = bits.RotateLeft32(h4, 13)
		h4 += h1
		h4 = h4*5 + 0x32ac3b17
	}

	tail := b[n*16:]
	var k [4]uint32
	for i := len(tail) - 1; i >= 0; i-- {
		k[i/4] ^= uint32(tail[i]) << (8 * (i % 4))
	}
	if len(tail) > 12 {
		k[3] *= c4
		k[3] = bits.RotateLeft32(k[3], 18)
		k[3] *= c1
		h4 ^= k[3]
	}
	if len(tail) > 8 {
		k[2] *= c3
		k[2] = bits.RotateLeft32(k[2], 17)
		k[2] *= c4
		h3 ^= k[2]
	}
	if len(tail) > 4 {
		k[1] *= c2
		k[1] = bits.RotateLeft32(k[1], 16)
		k[1] *= c3
		h2 ^= k[1]
	}
	if len(tail) > 0 {
		k[0] *= c1
		k[0] = bits.RotateLeft32(k[0], 15)
		k[0] *= c2
		h1 ^= k[0]
	}

	l := uint32(len(b))
	h1, h2, h3, h4 = h1^l, h2^l, h3^l, h4^l
	h1 += h2 + h3 + h4
	h2 += h1
	h3 += h1
	h4 += h1
	h1, h2, h3, h4 = fmix32(h1), fmix32(h2), fmix32(h3), fmix32(h4)
	h1 += h2 + h3 + h4
	h2 += h1
	h3 += h1
	h4 += h1
	return [4]uint32{h1, h2, h3, h4}
}

func fmix32(h uint32) uint32 {
	h ^= h >> 16
	h *= 0x85ebca6b
	h ^= h >> 13
	h *= 0xc2b2ae35
	h ^= h >> 16
	return h
}

// reduce is Lemire's multiply-shift: the high 32 bits of x * n, in [0, n).
func reduce(x, n uint32) uint32 {
	return uint32(uint64(x) * uint64(n) >> 32)
}

// writeFrame is an independent writer: header, params, payload, CRC.
func writeFrame(typ byte, params, payload []byte) []byte {
	bodyLen := len(params) + len(payload)
	b := make([]byte, headerSize, headerSize+bodyLen+trailerSize)
	copy(b, "DSTL")
	b[4], b[5] = version, typ
	le.PutUint32(b[8:], uint32(bodyLen))
	b = append(append(b, params...), payload...)
	return le.AppendUint32(b, crc32.ChecksumIEEE(b))
}

type bloom struct {
	m    uint32
	k    uint16
	seed uint32
	n    uint32
	bits []byte
}

const bloomParams = 16

func parseBloom(f frame) (bloom, error) {
	if f.typ != 1 || len(f.body) < bloomParams {
		return bloom{}, fmt.Errorf("not a Bloom frame")
	}
	p := f.body
	if p[14] != 0 || p[15] != 0 {
		return bloom{}, fmt.Errorf("Bloom params padding is not zero")
	}
	b := bloom{m: le.Uint32(p), k: le.Uint16(p[4:]), seed: le.Uint32(p[6:]), n: le.Uint32(p[10:]), bits: p[bloomParams:]}
	if len(b.bits) != int((b.m+7)/8) {
		return bloom{}, fmt.Errorf("Bloom payload of %d bytes, m=%d needs %d", len(b.bits), b.m, (b.m+7)/8)
	}
	return b, nil
}

// probes is variant 0's Bloom mapping: g_i = a + i*b + i*i mod 2^32, reduced
// into [0, m).
func (b bloom) probes(key string) []uint32 {
	w := murmur3x86_128([]byte(key), b.seed)
	out := make([]uint32, b.k)
	for i := range out {
		u := uint32(i)
		out[i] = reduce(w[0]+u*w[1]+u*u, b.m)
	}
	return out
}

func (b bloom) has(key string) bool {
	for _, i := range b.probes(key) {
		if b.bits[i>>3]&(1<<(i&7)) == 0 {
			return false
		}
	}
	return true
}

func buildBloom(m uint32, k uint16, seed, n uint32, keys []string) []byte {
	b := bloom{m: m, k: k, seed: seed, n: n, bits: make([]byte, (m+7)/8)}
	for _, key := range keys {
		for _, i := range b.probes(key) {
			b.bits[i>>3] |= 1 << (i & 7)
		}
	}
	params := make([]byte, bloomParams)
	le.PutUint32(params, m)
	le.PutUint16(params[4:], k)
	le.PutUint32(params[6:], seed)
	le.PutUint32(params[10:], n)
	return writeFrame(1, params, b.bits)
}

// hashVectors were taken once from the JS hash128Key, so a disagreement with
// JS reports as the hash rather than as a frame that differs. The golden keys
// are all under 8 bytes, so without the prefixes up to 33 bytes the block loop
// and the 9-15 byte tails would never be compared across languages.
var hashVectors = []struct {
	key  string
	want [4]uint32
}{
	{"", [4]uint32{0x00000000, 0x00000000, 0x00000000, 0x00000000}},
	{"T", [4]uint32{0x312658d4, 0xd32cba11, 0xd32cba11, 0xd32cba11}},
	{"Th", [4]uint32{0xee15ba68, 0x5ea9dec0, 0x5ea9dec0, 0x5ea9dec0}},
	{"The", [4]uint32{0x41d0bf79, 0xd27be85e, 0xd27be85e, 0xd27be85e}},
	{"The ", [4]uint32{0x00251e65, 0xaa6e1ea2, 0xaa6e1ea2, 0xaa6e1ea2}},
	{"The q", [4]uint32{0x392b67e0, 0xb9c452b8, 0xbfcc773c, 0xbfcc773c}},
	{"The qu", [4]uint32{0x02910834, 0xfa14aab4, 0x2b714bbf, 0x2b714bbf}},
	{"The qui", [4]uint32{0xa09f763b, 0x35527f9c, 0xddf6976e, 0xddf6976e}},
	{"The quic", [4]uint32{0x66b6c80a, 0xc96f1f6d, 0x6d8a0980, 0x6d8a0980}},
	{"The quick", [4]uint32{0xbac5d673, 0xcbc4cff3, 0xdeb68d09, 0x69c8528f}},
	{"The quick ", [4]uint32{0x9bf1477a, 0x73c5b1aa, 0x852e56f2, 0xdff305b6}},
	{"The quick b", [4]uint32{0x0c71da9e, 0xab63cd6f, 0x41612928, 0xa3768855}},
	{"The quick br", [4]uint32{0xc628765f, 0x4e4398a8, 0xebb5df5e, 0x5b59e222}},
	{"The quick bro", [4]uint32{0xe3c36e46, 0x2fda1565, 0xcea4d957, 0x7990934f}},
	{"The quick brow", [4]uint32{0x08bcd16f, 0x0f9b125b, 0x364ee897, 0x4772cb63}},
	{"The quick brown", [4]uint32{0xcad356cf, 0xebdbe493, 0x5f9fcb22, 0x2cc8a286}},
	{"The quick brown ", [4]uint32{0x05af2e98, 0x85dc9f00, 0x7a560e93, 0x1005cf2a}},
	{"The quick brown f", [4]uint32{0x315057c3, 0x66c13ca3, 0x828c6941, 0xb7707639}},
	{"The quick brown fo", [4]uint32{0xa01994e4, 0xd6fefc25, 0xd4b9e591, 0x3bc95ca5}},
	{"The quick brown fox", [4]uint32{0x22b291f7, 0xa35dd0df, 0x051704ea, 0xcff851ea}},
	{"The quick brown fox ", [4]uint32{0xfe38a094, 0x01810b9f, 0x6bb24530, 0x38b2aba5}},
	{"The quick brown fox j", [4]uint32{0xcd216e62, 0x3dcefd24, 0x2bf5f67e, 0x3c6f8be5}},
	{"The quick brown fox ju", [4]uint32{0xf5795533, 0x49f2eba2, 0x726b8b42, 0xf02b3a46}},
	{"The quick brown fox jum", [4]uint32{0x9de4178d, 0xc4165c1d, 0x65dba141, 0x72f17359}},
	{"The quick brown fox jump", [4]uint32{0x7908c90b, 0x6dc21ace, 0x43488a19, 0xf1a97237}},
	{"The quick brown fox jumps", [4]uint32{0x62a1b11b, 0x4e46f749, 0xe9f9a2c9, 0x2f667a74}},
	{"The quick brown fox jumps ", [4]uint32{0xfe36981e, 0xbacec997, 0x2500b9b9, 0xd68d3153}},
	{"The quick brown fox jumps o", [4]uint32{0x3e3939d6, 0xce1f0e3b, 0x2f9e725b, 0xaa508b3f}},
	{"The quick brown fox jumps ov", [4]uint32{0x4bd72ebc, 0x373823ed, 0x8f43575e, 0xcb9fffc0}},
	{"The quick brown fox jumps ove", [4]uint32{0xf9507c4d, 0x90f40c1d, 0xd5da107a, 0x0730447a}},
	{"The quick brown fox jumps over", [4]uint32{0x9c283a41, 0x6af26d4b, 0x5406eaab, 0xc5a336bf}},
	{"The quick brown fox jumps over ", [4]uint32{0x9756d6dd, 0x03ee8189, 0xb6d1f56e, 0x23a827f6}},
	{"The quick brown fox jumps over t", [4]uint32{0x7fc78aad, 0x2d537202, 0x102e762c, 0x393ef0c1}},
	{"The quick brown fox jumps over th", [4]uint32{0xad6ec1ae, 0xd6ad260a, 0x9d041c4a, 0xebac7c8b}},
	{"héllo wörld", [4]uint32{0x31b759f2, 0x489f6d8b, 0x7061676c, 0x62dbfc53}},
	{"日本語のキー", [4]uint32{0x1bcbaf04, 0x2b70136b, 0x6674f453, 0x2ea104d6}},
	{"🦀 crab", [4]uint32{0x70f21388, 0xa850520b, 0x511c6374, 0xd6330503}},   // a surrogate pair in JS
	{"\uFFFD", [4]uint32{0x15861a96, 0x39dfc326, 0x39dfc326, 0x39dfc326}},   // JS "\ud800", a lone high surrogate
	{"a\uFFFDb", [4]uint32{0x2ff91286, 0x0eafa77a, 0x62c3ec7c, 0x62c3ec7c}}, // JS "a\udc00b", a lone low surrogate
}

func TestHashVectors(t *testing.T) {
	for _, v := range hashVectors {
		if got := murmur3x86_128([]byte(v.key), 0); got != v.want {
			t.Errorf("murmur3(%q), %d bytes: %08x, want %08x", v.key, len(v.key), got, v.want)
		}
	}
}

func TestBloom(t *testing.T) {
	e := find(t, "bloom")
	golden := frameOf(t, e)
	f, err := readFrame(golden)
	if err != nil {
		t.Fatal(err)
	}
	b, err := parseBloom(f)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range e.Keys {
		if !b.has(key) {
			t.Errorf("has(%q) is false", key)
		}
	}
	if rebuilt := buildBloom(b.m, b.k, b.seed, b.n, e.Keys); !bytes.Equal(rebuilt, golden) {
		t.Errorf("rebuilt frame differs:\n got %x\nwant %x", rebuilt, golden)
	}
}

type blocked struct {
	numBlocks, seed, n uint32
	lanes              []uint32
}

const blockedParams = 16

// salts are the eight Parquet/Impala split-block salts, one per lane.
var salts = [8]uint32{
	0x47b6137b, 0x44974d91, 0x8824ad5b, 0xa2b7289d,
	0x705495c7, 0x2df1424b, 0x9efc4947, 0x5c6bfb31,
}

func parseBlocked(f frame) (blocked, error) {
	if f.typ != 2 || len(f.body) < blockedParams {
		return blocked{}, fmt.Errorf("not a Blocked frame")
	}
	p := f.body
	if le.Uint32(p[12:]) != 0 {
		return blocked{}, fmt.Errorf("Blocked params padding is not zero")
	}
	b := blocked{numBlocks: le.Uint32(p), seed: le.Uint32(p[4:]), n: le.Uint32(p[8:])}
	payload := p[blockedParams:]
	if len(payload) != int(b.numBlocks)*32 {
		return blocked{}, fmt.Errorf("Blocked payload of %d bytes, numBlocks=%d needs %d", len(payload), b.numBlocks, b.numBlocks*32)
	}
	b.lanes = make([]uint32, b.numBlocks*8)
	for i := range b.lanes {
		b.lanes[i] = le.Uint32(payload[4*i:])
	}
	return b, nil
}

// masks is variant 0's Blocked mapping: the block's first lane index, and the
// one bit each of its eight lanes must hold.
func (b blocked) masks(key string) (int, [8]uint32) {
	w := murmur3x86_128([]byte(key), b.seed)
	var m [8]uint32
	for i, salt := range salts {
		m[i] = 1 << ((w[1] * salt) >> 27)
	}
	return int(reduce(w[0], b.numBlocks)) * 8, m
}

func (b blocked) has(key string) bool {
	at, m := b.masks(key)
	for i, bit := range m {
		if b.lanes[at+i]&bit == 0 {
			return false
		}
	}
	return true
}

func buildBlocked(numBlocks, seed, n uint32, keys []string) []byte {
	b := blocked{numBlocks: numBlocks, seed: seed, n: n, lanes: make([]uint32, numBlocks*8)}
	for _, key := range keys {
		at, m := b.masks(key)
		for i, bit := range m {
			b.lanes[at+i] |= bit
		}
	}
	params := make([]byte, blockedParams)
	le.PutUint32(params, numBlocks)
	le.PutUint32(params[4:], seed)
	le.PutUint32(params[8:], n)
	payload := make([]byte, 0, len(b.lanes)*4)
	for _, w := range b.lanes {
		payload = le.AppendUint32(payload, w)
	}
	return writeFrame(2, params, payload)
}

func TestBlocked(t *testing.T) {
	var entries []entry
	wide := false
	for _, e := range golden(t) {
		if e.Kind != "blocked" {
			continue
		}
		entries = append(entries, e)
		f, err := readFrame(frameOf(t, e))
		if err != nil {
			t.Fatal(err)
		}
		wide = wide || le.Uint32(f.body) >= 4
	}
	if !wide {
		t.Fatal("no blocked fixture spans several blocks")
	}

	for _, e := range entries {
		golden := frameOf(t, e)
		f, _ := readFrame(golden)
		b, err := parseBlocked(f)
		if err != nil {
			t.Fatalf("%s: %v", e.Name, err)
		}
		for _, key := range e.Keys {
			if !b.has(key) {
				t.Errorf("%s: has(%q) is false", e.Name, key)
			}
		}
		if rebuilt := buildBlocked(b.numBlocks, b.seed, b.n, e.Keys); !bytes.Equal(rebuilt, golden) {
			t.Errorf("%s: rebuilt frame differs:\n got %x\nwant %x", e.Name, rebuilt, golden)
		}

		// A host-order reader on a little-endian runner passes everything
		// above, so the lanes must also be wrong when read the other way.
		swapped := blocked{numBlocks: b.numBlocks, seed: b.seed, lanes: make([]uint32, len(b.lanes))}
		for i, w := range b.lanes {
			swapped.lanes[i] = bits.ReverseBytes32(w)
		}
		if allHave(swapped.has, e.Keys) {
			t.Errorf("%s: byte-swapped lanes still answer every key", e.Name)
		}
	}
}

func allHave(has func(string) bool, keys []string) bool {
	for _, key := range keys {
		if !has(key) {
			return false
		}
	}
	return true
}

type fuse struct {
	seed, seg, segCountLen, size uint32
	fp                           []uint16
	mask                         uint16
}

const fuseParams = 16

func parseFuse(f frame) (fuse, error) {
	width := map[byte]int{3: 1, 4: 2}[f.typ]
	if width == 0 || len(f.body) < fuseParams {
		return fuse{}, fmt.Errorf("not a Fuse frame")
	}
	p := f.body
	r := fuse{seed: le.Uint32(p), seg: le.Uint32(p[4:]), segCountLen: le.Uint32(p[8:]), size: le.Uint32(p[12:])}
	payload := p[fuseParams:]
	n := int(r.segCountLen + 2*r.seg)
	if r.size == 0 {
		n = 0
	}
	if len(payload) != n*width {
		return fuse{}, fmt.Errorf("Fuse payload of %d bytes, want %d fingerprints of %d bytes", len(payload), n, width)
	}
	r.fp = make([]uint16, len(payload)/width)
	for i := range r.fp {
		if width == 1 {
			r.fp[i] = uint16(payload[i])
		} else {
			r.fp[i] = le.Uint16(payload[2*i:])
		}
	}
	r.mask = uint16(1<<(8*width) - 1)
	return r, nil
}

func fmix64(k uint64) uint64 {
	k ^= k >> 33
	k *= 0xff51afd7ed558ccd
	k ^= k >> 33
	k *= 0xc4ceb9fe1a85ec53
	k ^= k >> 33
	return k
}

// has is variant 0's Fuse mapping: three positions and a fingerprint from one
// 64-bit mix of the key hash and the attempt seed.
func (f fuse) has(key string) bool {
	if len(f.fp) == 0 {
		return false
	}
	w := murmur3x86_128([]byte(key), 0)
	mix := fmix64(uint64(w[1])<<32 | uint64(w[0]) + uint64(f.seed))
	h0, _ := bits.Mul64(mix, uint64(f.segCountLen))
	segMask := uint64(f.seg - 1)
	h1 := (h0 + uint64(f.seg)) ^ (mix >> 18 & segMask)
	h2 := (h0 + 2*uint64(f.seg)) ^ (mix & segMask)
	fingerprint := uint16(mix^mix>>32) & f.mask
	return f.fp[h0]^f.fp[h1]^f.fp[h2] == fingerprint
}

func TestFuse(t *testing.T) {
	empty := false
	for _, e := range golden(t) {
		if e.Kind != "fuse8" && e.Kind != "fuse16" {
			continue
		}
		name := e.Name
		empty = empty || len(e.Keys) == 0
		fr, err := readFrame(frameOf(t, e))
		if err != nil {
			t.Fatal(err)
		}
		f, err := parseFuse(fr)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		for _, key := range e.Keys {
			if !f.has(key) {
				t.Errorf("%s: has(%q) is false", name, key)
			}
		}
		// A reader answering true to everything passes the loop above.
		absent := 0
		for i := 0; i < 100; i++ {
			if !f.has(fmt.Sprintf("absent-%d", i)) {
				absent++
			}
		}
		if absent < 90 {
			t.Errorf("%s: only %d of 100 absent keys answer false", name, absent)
		}

		if e.Kind == "fuse16" {
			swapped := f
			swapped.fp = make([]uint16, len(f.fp))
			for i, v := range f.fp {
				swapped.fp[i] = bits.ReverseBytes16(v)
			}
			if allHave(swapped.has, e.Keys) {
				t.Errorf("%s: byte-swapped fingerprints still answer every key", name)
			}
		}
	}
	if !empty {
		t.Error("no empty Fuse fixture")
	}
}

type hll struct {
	p, encoding byte
	seed        uint32
	payload     []byte
}

const (
	hllParams = 8
	sparseP   = 25
)

func parseHLL(f frame) (hll, error) {
	if f.typ != 5 || len(f.body) < hllParams {
		return hll{}, fmt.Errorf("not an HLL frame")
	}
	p := f.body
	if p[6] != 0 || p[7] != 0 {
		return hll{}, fmt.Errorf("HLL params padding is not zero")
	}
	return hll{p: p[0], encoding: p[1], seed: le.Uint32(p[2:]), payload: p[hllParams:]}, nil
}

// registers materialises the register array from either encoding.
func (h hll) registers() ([]byte, error) {
	r := make([]byte, 1<<h.p)
	switch h.encoding {
	case 0:
		if len(h.payload) != len(r)*6/8 {
			return nil, fmt.Errorf("dense payload of %d bytes, p=%d needs %d", len(h.payload), h.p, len(r)*6/8)
		}
		// Six bits LSB-first, reading only the bytes a register spans; the
		// last one always fits inside the final byte.
		for i := range r {
			bit := 6 * i
			at, shift := bit>>3, bit&7
			v := h.payload[at] >> shift
			if shift > 2 {
				v |= h.payload[at+1] << (8 - shift)
			}
			r[i] = v & 0x3f
		}
	case 1:
		if len(h.payload)%4 != 0 {
			return nil, fmt.Errorf("sparse payload of %d bytes is not whole entries", len(h.payload))
		}
		for i := 0; i < len(h.payload); i += 4 {
			e := le.Uint32(h.payload[i:])
			reg, rho := (e>>6)>>(sparseP-h.p), byte(e&0x3f)
			r[reg] = max(r[reg], rho)
		}
	default:
		return nil, fmt.Errorf("unknown HLL encoding %d", h.encoding)
	}
	return r, nil
}

// registersFromKeys is variant 0's HLL mapping: the top p bits of w0 pick the
// register, and rho is the 1-based first set bit of the 64 - p bits after them.
func registersFromKeys(p byte, seed uint32, keys []string) []byte {
	r := make([]byte, 1<<p)
	for _, key := range keys {
		w := murmur3x86_128([]byte(key), seed)
		reg := w[0] >> (32 - p)
		rho := byte(64 - p + 1)
		if rest := (uint64(w[0])<<32 | uint64(w[1])) << p; rest != 0 {
			rho = byte(bits.LeadingZeros64(rest) + 1)
		}
		r[reg] = max(r[reg], rho)
	}
	return r
}

func TestHLL(t *testing.T) {
	var denseWide *entry
	var entries []entry
	for _, e := range golden(t) {
		if e.Kind != "hll" {
			continue
		}
		entries = append(entries, e)
		f, err := readFrame(frameOf(t, e))
		if err != nil {
			t.Fatal(err)
		}
		if f.body[0] >= 10 && f.body[1] == 0 {
			denseWide = &e
		}
	}
	if denseWide == nil {
		t.Fatal("no dense HLL fixture above p=4")
	}

	for _, e := range entries {
		f, _ := readFrame(frameOf(t, e))
		h, err := parseHLL(f)
		if err != nil {
			t.Fatalf("%s: %v", e.Name, err)
		}
		got, err := h.registers()
		if err != nil {
			t.Fatalf("%s: %v", e.Name, err)
		}
		want := registersFromKeys(h.p, h.seed, e.Keys)
		if !bytes.Equal(got, want) {
			t.Errorf("%s: decoded registers differ from the keys'\n got %v\nwant %v", e.Name, got, want)
		}
		if e.Name != denseWide.Name {
			continue
		}
		// Register i starts at bit 6i & 7, which cycles 0, 6, 4, 2, so every
		// phase of the packing, including the byte-straddling ones, is read.
		var phases [4]bool
		for i, r := range got {
			phases[i%4] = phases[i%4] || r != 0
		}
		if phases != [4]bool{true, true, true, true} {
			t.Errorf("%s: set registers cover packing phases %v, want all four", e.Name, phases)
		}
	}
}

type scalableStage struct {
	bloom
	capacity, count uint32
}

type scalable struct {
	n, seed                     uint32
	epsilon, growth, tightening float64
	stages                      []scalableStage
}

const (
	scalableParams = 40
	scalableEntry  = 16
)

func padded8(n int) int { return (n + 7) / 8 * 8 }

// parseScalable reads type 6 as the reference lays it out: params, a
// 16-byte entry per stage, then each stage's bits padded to 8.
func parseScalable(f frame) (scalable, error) {
	if f.typ != 6 || len(f.body) < scalableParams {
		return scalable{}, fmt.Errorf("not a Scalable Bloom frame")
	}
	p := f.body
	if le.Uint32(p[36:]) != 0 {
		return scalable{}, fmt.Errorf("params padding is not zero")
	}
	s := scalable{
		n:          le.Uint32(p),
		seed:       le.Uint32(p[4:]),
		epsilon:    math.Float64frombits(le.Uint64(p[8:])),
		growth:     math.Float64frombits(le.Uint64(p[16:])),
		tightening: math.Float64frombits(le.Uint64(p[24:])),
	}
	count := int(le.Uint32(p[32:]))
	tableEnd := scalableParams + scalableEntry*count
	if count == 0 || len(p) < tableEnd {
		return scalable{}, fmt.Errorf("stage count %d does not fit a %d-byte body", count, len(p))
	}
	at := tableEnd
	for i := 0; i < count; i++ {
		e := p[scalableParams+scalableEntry*i:]
		if le.Uint16(e[6:]) != 0 {
			return scalable{}, fmt.Errorf("stage %d table padding is not zero", i)
		}
		st := scalableStage{
			bloom:    bloom{m: le.Uint32(e), k: le.Uint16(e[4:]), seed: s.seed},
			capacity: le.Uint32(e[8:]),
			count:    le.Uint32(e[12:]),
		}
		length := int((st.m + 7) / 8)
		if at+padded8(length) > len(p) {
			return scalable{}, fmt.Errorf("stage %d runs past the body", i)
		}
		st.bits = p[at : at+length]
		for _, b := range p[at+length : at+padded8(length)] {
			if b != 0 {
				return scalable{}, fmt.Errorf("stage %d bit padding is not zero", i)
			}
		}
		at += padded8(length)
		s.stages = append(s.stages, st)
	}
	if at != len(p) {
		return scalable{}, fmt.Errorf("body is %d bytes, the stage table implies %d", len(p), at)
	}
	return s, nil
}

// has is true if any stage holds the key.
func (s scalable) has(key string) bool {
	for _, st := range s.stages {
		if st.bloom.has(key) {
			return true
		}
	}
	return false
}

// buildScalable replays the keys by the reference's add rule into the stage
// geometry the frame stores, then writes the frame with its own writer.
func buildScalable(s scalable, keys []string) ([]byte, error) {
	open := func(i int) scalableStage {
		st := s.stages[i]
		st.bits = make([]byte, (st.m+7)/8)
		st.count = 0
		return st
	}
	chain := scalable{n: s.n, seed: s.seed, epsilon: s.epsilon, growth: s.growth, tightening: s.tightening}
	chain.stages = []scalableStage{open(0)}
	for _, key := range keys {
		if chain.has(key) {
			continue
		}
		newest := &chain.stages[len(chain.stages)-1]
		if newest.count >= newest.capacity {
			if len(chain.stages) == len(s.stages) {
				return nil, fmt.Errorf("replaying the keys needs more than the %d stages the frame stores", len(s.stages))
			}
			chain.stages = append(chain.stages, open(len(chain.stages)))
			newest = &chain.stages[len(chain.stages)-1]
		}
		for _, i := range newest.probes(key) {
			newest.bits[i>>3] |= 1 << (i & 7)
		}
		newest.count++
	}

	params := make([]byte, scalableParams)
	le.PutUint32(params, chain.n)
	le.PutUint32(params[4:], chain.seed)
	le.PutUint64(params[8:], math.Float64bits(chain.epsilon))
	le.PutUint64(params[16:], math.Float64bits(chain.growth))
	le.PutUint64(params[24:], math.Float64bits(chain.tightening))
	le.PutUint32(params[32:], uint32(len(chain.stages)))
	var payload []byte
	for _, st := range chain.stages {
		entry := make([]byte, scalableEntry)
		le.PutUint32(entry, st.m)
		le.PutUint16(entry[4:], st.k)
		le.PutUint32(entry[8:], st.capacity)
		le.PutUint32(entry[12:], st.count)
		payload = append(payload, entry...)
	}
	for _, st := range chain.stages {
		payload = append(payload, st.bits...)
		payload = append(payload, make([]byte, padded8(len(st.bits))-len(st.bits))...)
	}
	return writeFrame(6, params, payload), nil
}

func TestScalable(t *testing.T) {
	var entries []entry
	for _, e := range golden(t) {
		if e.Kind == "scalable" {
			entries = append(entries, e)
		}
	}
	wide := false
	for _, e := range entries {
		golden := frameOf(t, e)
		f, err := readFrame(golden)
		if err != nil {
			t.Fatal(err)
		}
		s, err := parseScalable(f)
		if err != nil {
			t.Fatalf("%s: %v", e.Name, err)
		}
		wide = wide || len(s.stages) >= 3
		for _, key := range e.Keys {
			if !s.has(key) {
				t.Errorf("%s: has(%q) is false", e.Name, key)
			}
		}
		rebuilt, err := buildScalable(s, e.Keys)
		if err != nil {
			t.Fatalf("%s: %v", e.Name, err)
		}
		if !bytes.Equal(rebuilt, golden) {
			t.Errorf("%s: rebuilt frame differs:\n got %x\nwant %x", e.Name, rebuilt, golden)
		}
	}
	if !wide {
		t.Error("no scalable fixture spans three stages")
	}
}

type cuckoo struct {
	n, seed    uint32
	epsilon    float64
	f, buckets uint32
	count      uint32
	words      []uint32
}

const cuckooParams = 32

func (c cuckoo) m() uint32 { return 4 * c.f * c.buckets }

// parseCuckoo reads type 7 as the reference lays it out and applies its
// checks: params padding, exact length, zero bits past m and zero pad bytes,
// and a count equal to the occupied slots.
func parseCuckoo(f frame) (cuckoo, error) {
	if f.typ != 7 || len(f.body) < cuckooParams {
		return cuckoo{}, fmt.Errorf("not a Cuckoo frame")
	}
	p := f.body
	if le.Uint32(p[28:]) != 0 {
		return cuckoo{}, fmt.Errorf("params padding is not zero")
	}
	c := cuckoo{
		n:       le.Uint32(p),
		seed:    le.Uint32(p[4:]),
		epsilon: math.Float64frombits(le.Uint64(p[8:])),
		f:       le.Uint32(p[16:]),
		buckets: le.Uint32(p[20:]),
		count:   le.Uint32(p[24:]),
	}
	if c.f < 4 || c.f > 32 || c.buckets == 0 {
		return cuckoo{}, fmt.Errorf("f %d or buckets %d out of range", c.f, c.buckets)
	}
	words := int((c.m() + 31) / 32)
	if len(p) != cuckooParams+padded8(4*words) {
		return cuckoo{}, fmt.Errorf("body is %d bytes, the geometry implies %d", len(p), cuckooParams+padded8(4*words))
	}
	c.words = make([]uint32, words)
	for w := range c.words {
		c.words[w] = le.Uint32(p[cuckooParams+4*w:])
	}
	if tail := c.m() % 32; tail != 0 && c.words[words-1]>>tail != 0 {
		return cuckoo{}, fmt.Errorf("bits set past the last slot")
	}
	for _, b := range p[cuckooParams+4*words:] {
		if b != 0 {
			return cuckoo{}, fmt.Errorf("slot padding is not zero")
		}
	}
	occupied := uint32(0)
	for j := uint32(0); j < 4*c.buckets; j++ {
		if c.slot(j) != 0 {
			occupied++
		}
	}
	if occupied != c.count {
		return cuckoo{}, fmt.Errorf("count %d, %d slots occupied", c.count, occupied)
	}
	return c, nil
}

// slot j is f bits from stream bit j*f, low bit first; stream bit x is bit
// x&31 of word x>>5.
func (c cuckoo) slot(j uint32) uint32 {
	v := uint32(0)
	for b := uint32(0); b < c.f; b++ {
		x := j*c.f + b
		v |= (c.words[x>>5] >> (x & 31) & 1) << b
	}
	return v
}

func (c cuckoo) setSlot(j, v uint32) {
	for b := uint32(0); b < c.f; b++ {
		x := j*c.f + b
		c.words[x>>5] = c.words[x>>5]&^(1<<(x&31)) | (v>>b&1)<<(x&31)
	}
}

func (c cuckoo) alt(i, fp uint32) uint32 {
	return (fp*0x5bd1e995%c.buckets + c.buckets - i) % c.buckets
}

// hash gives a key's fingerprint, both buckets, and the words that seed the
// eviction walk.
func (c cuckoo) hash(key string) (fp, i1, i2 uint32, w [4]uint32) {
	w = murmur3x86_128([]byte(key), c.seed)
	fp = w[1] >> (32 - c.f)
	if fp == 0 {
		fp = 1
	}
	i1 = reduce(w[0], c.buckets)
	return fp, i1, c.alt(i1, fp), w
}

// find is the first slot of bucket i holding v, or -1.
func (c cuckoo) find(i, v uint32) int64 {
	for s := uint32(0); s < 4; s++ {
		if c.slot(4*i+s) == v {
			return int64(4*i + s)
		}
	}
	return -1
}

func (c cuckoo) has(key string) bool {
	fp, i1, i2, _ := c.hash(key)
	return c.find(i1, fp) >= 0 || c.find(i2, fp) >= 0
}

func (c *cuckoo) put(i, fp uint32) bool {
	j := c.find(i, 0)
	if j < 0 {
		return false
	}
	c.setSlot(uint32(j), fp)
	return true
}

// add follows the reference: first empty slot of i1 then i2, else the
// eviction walk of at most 500 kicks.
func (c *cuckoo) add(key string) error {
	fp, i1, i2, w := c.hash(key)
	if c.put(i1, fp) || c.put(i2, fp) {
		c.count++
		return nil
	}
	i := i1
	if w[2]&1 != 0 {
		i = i2
	}
	x := w[3] | 1
	for kick := 0; kick < 500; kick++ {
		x ^= x << 13
		x ^= x >> 17
		x ^= x << 5
		j := 4*i + x&3
		victim := c.slot(j)
		c.setSlot(j, fp)
		fp = victim
		i = c.alt(i, fp)
		if c.put(i, fp) {
			c.count++
			return nil
		}
	}
	return fmt.Errorf("add of %q ran out of kicks", key)
}

// remove clears the first slot equal to the key's fingerprint in i1, then
// i2 unless it is the same bucket.
func (c *cuckoo) remove(key string) {
	fp, i1, i2, _ := c.hash(key)
	scan := []uint32{i1}
	if i2 != i1 {
		scan = append(scan, i2)
	}
	for _, i := range scan {
		if j := c.find(i, fp); j >= 0 {
			c.setSlot(uint32(j), 0)
			c.count--
			return
		}
	}
}

// buildCuckoo replays the adds, then the deletes, into the stored geometry
// and writes the frame with its own writer.
func buildCuckoo(c cuckoo, keys, deletes []string) ([]byte, error) {
	fresh := cuckoo{n: c.n, seed: c.seed, epsilon: c.epsilon, f: c.f, buckets: c.buckets, words: make([]uint32, len(c.words))}
	for _, key := range keys {
		if err := fresh.add(key); err != nil {
			return nil, err
		}
	}
	for _, key := range deletes {
		fresh.remove(key)
	}
	params := make([]byte, cuckooParams)
	le.PutUint32(params, fresh.n)
	le.PutUint32(params[4:], fresh.seed)
	le.PutUint64(params[8:], math.Float64bits(fresh.epsilon))
	le.PutUint32(params[16:], fresh.f)
	le.PutUint32(params[20:], fresh.buckets)
	le.PutUint32(params[24:], fresh.count)
	payload := make([]byte, padded8(4*len(fresh.words)))
	for w, word := range fresh.words {
		le.PutUint32(payload[4*w:], word)
	}
	return writeFrame(7, params, payload), nil
}

func TestCuckoo(t *testing.T) {
	deleted := false
	for _, e := range golden(t) {
		if e.Kind != "cuckoo" {
			continue
		}
		deleted = deleted || len(e.Deletes) > 0
		golden := frameOf(t, e)
		f, err := readFrame(golden)
		if err != nil {
			t.Fatal(err)
		}
		c, err := parseCuckoo(f)
		if err != nil {
			t.Fatalf("%s: %v", e.Name, err)
		}
		gone := map[string]bool{}
		for _, key := range e.Deletes {
			gone[key] = true
		}
		for _, key := range e.Keys {
			if !gone[key] && !c.has(key) {
				t.Errorf("%s: has(%q) is false", e.Name, key)
			}
		}
		rebuilt, err := buildCuckoo(c, e.Keys, e.Deletes)
		if err != nil {
			t.Fatalf("%s: %v", e.Name, err)
		}
		if !bytes.Equal(rebuilt, golden) {
			t.Errorf("%s: rebuilt frame differs:\n got %x\nwant %x", e.Name, rebuilt, golden)
		}
	}
	if !deleted {
		t.Error("no cuckoo fixture exercises delete")
	}
}

// Count-Min, frame type 8: width and depth rows of u32 counters, row major.
// The frame stores no total, because under plain increment every row sums to
// it; deriving it is therefore also an integrity check on the counters.
type countMin struct {
	width, depth, seed uint32
	counters           []uint32
	total              uint64
}

const countMinParams = 16

func parseCountMin(f frame) (countMin, error) {
	if len(f.body) < countMinParams {
		return countMin{}, fmt.Errorf("body of %d bytes is shorter than the params block", len(f.body))
	}
	for at := 12; at < countMinParams; at++ {
		if f.body[at] != 0 {
			return countMin{}, fmt.Errorf("params padding at byte %d is not zero", at)
		}
	}
	c := countMin{
		width: le.Uint32(f.body),
		depth: le.Uint32(f.body[4:]),
		seed:  le.Uint32(f.body[8:]),
	}
	if c.width == 0 || c.depth == 0 {
		return countMin{}, fmt.Errorf("geometry %dx%d has an empty dimension", c.width, c.depth)
	}
	cells := uint64(c.width) * uint64(c.depth)
	if want := uint64(countMinParams) + 4*cells; uint64(len(f.body)) != want {
		return countMin{}, fmt.Errorf("body of %d bytes disagrees with a %dx%d geometry (want %d)", len(f.body), c.width, c.depth, want)
	}
	c.counters = make([]uint32, cells)
	for i := range c.counters {
		c.counters[i] = le.Uint32(f.body[countMinParams+4*i:])
	}
	for r := uint32(0); r < c.depth; r++ {
		var sum uint64
		for i := r * c.width; i < (r+1)*c.width; i++ {
			sum += uint64(c.counters[i])
		}
		if r == 0 {
			c.total = sum
		} else if sum != c.total {
			return countMin{}, fmt.Errorf("row %d sums to %d, but row 0 sums to %d", r, sum, c.total)
		}
	}
	return c, nil
}

// count is the smallest row's counter, each row probing at the same enhanced
// double-hash position bloom uses, offset into that row.
func (c countMin) count(key string) uint32 {
	w := murmur3x86_128([]byte(key), c.seed)
	min := ^uint32(0)
	for r := uint32(0); r < c.depth; r++ {
		at := r*c.width + reduce(w[0]+r*w[1]+r*r, c.width)
		if v := c.counters[at]; v < min {
			min = v
		}
	}
	return min
}

// buildCountMin writes the frame the recipe implies, from the geometry the
// golden frame stores. Comparing bytes rather than fields is what proves the
// two writers agree on the whole layout, not only on the parts a reader reads.
func buildCountMin(c countMin, keys []string) []byte {
	counters := make([]uint32, uint64(c.width)*uint64(c.depth))
	for _, key := range keys {
		w := murmur3x86_128([]byte(key), c.seed)
		for r := uint32(0); r < c.depth; r++ {
			counters[r*c.width+reduce(w[0]+r*w[1]+r*r, c.width)]++
		}
	}
	params := make([]byte, countMinParams)
	le.PutUint32(params, c.width)
	le.PutUint32(params[4:], c.depth)
	le.PutUint32(params[8:], c.seed)
	payload := make([]byte, 4*len(counters))
	for i, v := range counters {
		le.PutUint32(payload[4*i:], v)
	}
	return writeFrame(8, params, payload)
}

func TestCountMin(t *testing.T) {
	seeded := false
	for _, e := range golden(t) {
		if e.Kind != "countmin" {
			continue
		}
		f, err := readFrame(frameOf(t, e))
		if err != nil {
			t.Fatal(err)
		}
		c, err := parseCountMin(f)
		if err != nil {
			t.Fatalf("%s: %v", e.Name, err)
		}
		seeded = seeded || c.seed != 0
		truth := map[string]uint32{}
		for _, key := range e.Keys {
			truth[key]++
		}
		for key, n := range truth {
			if got := c.count(key); got < n {
				t.Errorf("%s: count(%q) is %d, below the true %d", e.Name, key, got, n)
			}
		}
		if want := uint64(len(e.Keys)); c.total != want {
			t.Errorf("%s: total %d, want %d", e.Name, c.total, want)
		}
		rebuilt := buildCountMin(c, e.Keys)
		if golden := frameOf(t, e); !bytes.Equal(rebuilt, golden) {
			t.Errorf("%s: rebuilt frame differs:\n got %x\nwant %x", e.Name, rebuilt, golden)
		}
	}
	if !seeded {
		t.Error("no countmin fixture carries a non-zero seed")
	}
}

// reseal recomputes the CRC trailer so a mutation reaches the check under test
// instead of stopping at the checksum.
func reseal(b []byte) []byte {
	end := len(b) - trailerSize
	le.PutUint32(b[end:], crc32.ChecksumIEEE(b[:end]))
	return b
}

func TestCountMinDamaged(t *testing.T) {
	e := find(t, "countmin")

	short := frameOf(t, e)
	if _, err := readFrame(short[:len(short)-1]); err == nil || !strings.Contains(err.Error(), "body length") {
		t.Errorf("truncated frame: want a body length error, got %v", err)
	}

	stale := frameOf(t, e)
	stale[headerSize+countMinParams]++
	if _, err := readFrame(stale); err == nil || !strings.Contains(err.Error(), "CRC") {
		t.Errorf("altered counter: want a CRC error, got %v", err)
	}

	// Resealed, the mutation gets past the trailer and has to be caught by the
	// row sums alone. This is what lets the frame leave the total out.
	hidden := frameOf(t, e)
	hidden[headerSize+countMinParams]++
	f, err := readFrame(reseal(hidden))
	if err != nil {
		t.Fatalf("resealed frame: %v", err)
	}
	if _, err := parseCountMin(f); err == nil || !strings.Contains(err.Error(), "sums to") {
		t.Errorf("altered counter: want a row sum error, got %v", err)
	}
}
