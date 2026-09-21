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

func TestBloom(t *testing.T) {
	if got := murmur3x86_128(nil, 0); got != [4]uint32{} {
		t.Errorf("murmur3 of empty input: %08x, want all zero", got)
	}
	// Taken once from the JS hash128Key("hello"), so a disagreement with JS
	// reports as the hash rather than as a Bloom frame that differs.
	want := [4]uint32{0x2b2444a0, 0xdb91def7, 0x9adb31b6, 0x9adb31b6}
	if got := murmur3x86_128([]byte("hello"), 0); got != want {
		t.Fatalf("murmur3(hello): %08x, want %08x", got, want)
	}

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
	if n := int(r.segCountLen + 2*r.seg); len(payload) != n*width {
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
	for _, name := range []string{"fuse8", "fuse16"} {
		e := find(t, name)
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

		if name == "fuse16" {
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
		// Six bits LSB-first; the high byte is absent for the last register,
		// whose six bits end exactly on the payload's last byte.
		for i := range r {
			bit := 6 * i
			v := uint16(h.payload[bit>>3])
			if at := bit>>3 + 1; at < len(h.payload) {
				v |= uint16(h.payload[at]) << 8
			}
			r[i] = byte(v>>(bit&7)) & 0x3f
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
