package main

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"sort"

	"github.com/DataDog/sketches-go/ddsketch"
	"github.com/DataDog/sketches-go/ddsketch/mapping"
	"github.com/DataDog/sketches-go/ddsketch/store"
	"google.golang.org/protobuf/proto"
)

type protoCase struct {
	Name             string       `json:"name"`
	Mapping          string       `json:"mapping"`
	RelativeAccuracy float64      `json:"relativeAccuracy"`
	Store            string       `json:"store"`
	Values           []float64    `json:"values"`
	Weight           float64      `json:"weight,omitempty"`
	Message          string       `json:"message"`
	Gamma            float64      `json:"gamma"`
	IndexOffset      float64      `json:"indexOffset"`
	Interpolation    int32        `json:"interpolation"`
	ZeroCount        float64      `json:"zeroCount"`
	Positive         [][2]float64 `json:"positive"`
	Negative         [][2]float64 `json:"negative"`
}

func bins(s store.Store) [][2]float64 {
	out := [][2]float64{}
	s.ForEach(func(index int, count float64) bool {
		if count != 0 {
			out = append(out, [2]float64{float64(index), count})
		}
		return false
	})
	sort.Slice(out, func(a, b int) bool { return out[a][0] < out[b][0] })
	return out
}

// Mixed sign, zeros, and spread over decades; none sits on a bin boundary.
var mixed = []float64{3.7, 12.25, -0.41, 0, 1500.3, 3.7, -88.8, 0.0062, 0, 42.42, -3.7, 7777.7}

// writeProtobuf prints the sketches-go protobuf fixture. Each case's accuracy
// is one where JS derives the same gamma as Go, so a sketch rebuilt in JS
// from the inputs can be held to Go's bytes.
func writeProtobuf() {
	cases := []struct {
		name, kind, storeKind string
		acc                   float64
		values                []float64
		weight                float64
	}{
		{"log-dense", "log", "dense", 0.01, mixed, 0},
		{"cubic-dense", "cubic", "dense", 0.05, mixed, 0},
		{"linear-dense", "linear", "dense", 0.01, mixed, 0},
		{"log-sparse", "log", "sparse", 0.01, mixed, 0},
		{"log-weighted", "log", "dense", 0.01, mixed, 2.5},
		{"empty", "log", "dense", 0.01, []float64{}, 0},
	}
	var out []protoCase
	for _, c := range cases {
		var m mapping.IndexMapping
		switch c.kind {
		case "log":
			m, _ = mapping.NewLogarithmicMapping(c.acc)
		case "linear":
			m, _ = mapping.NewLinearlyInterpolatedMapping(c.acc)
		case "cubic":
			m, _ = mapping.NewCubicallyInterpolatedMapping(c.acc)
		}
		newStore := func() store.Store { return store.NewDenseStore() }
		if c.storeKind == "sparse" {
			newStore = func() store.Store { return store.NewSparseStore() }
		}
		s := ddsketch.NewDDSketch(m, newStore(), newStore())
		for _, v := range c.values {
			if c.weight > 0 {
				_ = s.AddWithCount(v, c.weight)
			} else {
				_ = s.Add(v)
			}
		}
		pb := s.ToProto()
		msg, err := proto.MarshalOptions{Deterministic: true}.Marshal(pb)
		if err != nil {
			panic(err)
		}
		out = append(out, protoCase{
			Name: c.name, Mapping: c.kind, RelativeAccuracy: c.acc, Store: c.storeKind,
			Values: c.values, Weight: c.weight,
			Message:       base64.StdEncoding.EncodeToString(msg),
			Gamma:         pb.Mapping.Gamma,
			IndexOffset:   pb.Mapping.IndexOffset,
			Interpolation: int32(pb.Mapping.Interpolation),
			ZeroCount:     s.GetZeroCount(),
			Positive:      bins(s.GetPositiveValueStore()),
			Negative:      bins(s.GetNegativeValueStore()),
		})
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", " ")
	if err := enc.Encode(map[string]any{
		"reference": "github.com/DataDog/sketches-go v1.4.8",
		"arch":      "amd64",
		"cases":     out,
	}); err != nil {
		panic(err)
	}
}
