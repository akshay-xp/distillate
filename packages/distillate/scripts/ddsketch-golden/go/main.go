// Writes the sketches-go golden mapping fixture. Run through ../gen.sh, which
// pins GOARCH=amd64; see there for why.
package main

import (
	"bufio"
	"fmt"
	"math"
	"os"
	"strconv"

	"github.com/DataDog/sketches-go/ddsketch/mapping"
)

type entry struct {
	kind                       string
	acc, gamma, offset         float64
	minIndexable, maxIndexable float64
	cases                      [][2]float64
}

// Values spread across exponents -300..300, from a fixed xorshift so the
// fixture is reproducible. Mirrored in ../java/Gen.java.
func samples() []float64 {
	out := make([]float64, 0, 500)
	r := uint64(88172645463325252)
	for len(out) < 500 {
		r ^= r << 13
		r ^= r >> 7
		r ^= r << 17
		e := float64(int(r%601) - 300)
		out = append(out, math.Float64frombits((r>>12)|0x3ff0000000000000)*math.Pow(2, e))
	}
	return out
}

func cases(m mapping.IndexMapping) [][2]float64 {
	vals := samples()
	lo, hi := m.Index(m.MinIndexableValue()), m.Index(m.MaxIndexableValue())
	idx := []int{}
	for i := -50; i <= 50; i++ {
		idx = append(idx, i)
	}
	for k := 0; k < 50; k++ {
		idx = append(idx, lo+1+int(float64(hi-lo-2)*float64(k)/49))
	}
	for _, i := range idx {
		b := m.LowerBound(i)
		vals = append(vals, b, math.Nextafter(b, 0), math.Nextafter(b, math.Inf(1)))
	}
	out := [][2]float64{}
	for _, v := range vals {
		if v < m.MinIndexableValue() || v > m.MaxIndexableValue() {
			continue
		}
		out = append(out, [2]float64{v, float64(m.Index(v))})
	}
	return out
}

// Shortest round-trip form, which JSON.parse reads back to the same float.
func num(v float64) string { return strconv.FormatFloat(v, 'g', -1, 64) }

func main() {
	if len(os.Args) > 1 && os.Args[1] == "protobuf" {
		writeProtobuf()
		return
	}
	var es []entry
	for _, acc := range []float64{0.05, 0.01, 0.001} {
		lg, _ := mapping.NewLogarithmicMapping(acc)
		ln, _ := mapping.NewLinearlyInterpolatedMapping(acc)
		cb, _ := mapping.NewCubicallyInterpolatedMapping(acc)
		for _, km := range []struct {
			kind string
			m    mapping.IndexMapping
		}{{"log", lg}, {"linear", ln}, {"cubic", cb}} {
			pb := km.m.ToProto()
			es = append(es, entry{km.kind, acc, pb.Gamma, pb.IndexOffset,
				km.m.MinIndexableValue(), km.m.MaxIndexableValue(), cases(km.m)})
		}
	}
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	fmt.Fprint(w, "{\n \"reference\": \"github.com/DataDog/sketches-go v1.4.8\",\n \"arch\": \"amd64\",\n \"mappings\": [")
	for i, e := range es {
		if i > 0 {
			fmt.Fprint(w, ",")
		}
		fmt.Fprintf(w, "\n  {\n   \"kind\": %q,\n   \"relativeAccuracy\": %s,\n   \"gamma\": %s,\n   \"indexOffset\": %s,\n   \"minIndexableValue\": %s,\n   \"maxIndexableValue\": %s,\n   \"cases\": [",
			e.kind, num(e.acc), num(e.gamma), num(e.offset), num(e.minIndexable), num(e.maxIndexable))
		for j, c := range e.cases {
			if j > 0 {
				fmt.Fprint(w, ",")
			}
			fmt.Fprintf(w, "\n    [%s, %d]", num(c[0]), int(c[1]))
		}
		fmt.Fprint(w, "\n   ]\n  }")
	}
	fmt.Fprint(w, "\n ]\n}\n")
}
