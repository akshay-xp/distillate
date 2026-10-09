// Writes the sketches-java golden mapping fixture for the mappings sketches-go
// does not have: quadratic, and the bitwise linear mapping that Datadog's
// DDSketch.fast() builds on. Run through ../gen.sh.
import com.datadoghq.sketch.ddsketch.mapping.BitwiseLinearlyInterpolatedMapping;
import com.datadoghq.sketch.ddsketch.mapping.IndexMapping;
import com.datadoghq.sketch.ddsketch.mapping.QuadraticallyInterpolatedMapping;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;

public class Gen {
  // Mirrors samples() in ../go/main.go.
  static List<Double> samples() {
    List<Double> out = new ArrayList<>();
    long r = 88172645463325252L;
    while (out.size() < 500) {
      r ^= r << 13;
      r ^= r >>> 7;
      r ^= r << 17;
      long e = Long.remainderUnsigned(r, 601) - 300;
      out.add(Double.longBitsToDouble((r >>> 12) | 0x3ff0000000000000L) * Math.pow(2, e));
    }
    return out;
  }

  static double field(Object m, String name) throws Exception {
    Field f = m.getClass().getSuperclass().getDeclaredField(name);
    f.setAccessible(true);
    return f.getDouble(m);
  }

  // The bitwise mapping keeps its multiplier as an int and computes gamma as
  // 2^(1 / multiplier), with no index offset.
  static double bitwiseGamma(BitwiseLinearlyInterpolatedMapping m) throws Exception {
    Field f = m.getClass().getDeclaredField("multiplier");
    f.setAccessible(true);
    return Math.pow(2, 1.0 / f.getInt(m));
  }

  public static void main(String[] args) throws Exception {
    StringBuilder s = new StringBuilder();
    s.append("{\n \"reference\": \"com.datadoghq:sketches-java 0.8.3\",\n \"arch\": \"jvm\",\n \"mappings\": [");
    double[] accs = {0.05, 0.01, 0.001};
    int written = 0;
    for (String kind : new String[] {"quadratic", "bitwise"})
    for (int a = 0; a < accs.length; a++) {
      IndexMapping m;
      double gamma;
      double indexOffset;
      if (kind.equals("quadratic")) {
        m = new QuadraticallyInterpolatedMapping(accs[a]);
        gamma = field(m, "gamma");
        indexOffset = field(m, "indexOffset");
      } else {
        BitwiseLinearlyInterpolatedMapping b = new BitwiseLinearlyInterpolatedMapping(accs[a]);
        m = b;
        gamma = bitwiseGamma(b);
        indexOffset = 0;
      }
      List<Double> vals = samples();
      int lo = m.index(m.minIndexableValue()), hi = m.index(m.maxIndexableValue());
      List<Integer> idx = new ArrayList<>();
      for (int i = -50; i <= 50; i++) idx.add(i);
      for (int k = 0; k < 50; k++) idx.add(lo + 1 + (int) ((double) (hi - lo - 2) * k / 49));
      for (int i : idx) {
        double b = m.lowerBound(i);
        vals.add(b);
        vals.add(Math.nextDown(b));
        vals.add(Math.nextUp(b));
      }
      s.append(written++ == 0 ? "\n" : ",\n")
          .append("  {\n   \"kind\": \"").append(kind).append("\",\n   \"relativeAccuracy\": ").append(accs[a])
          .append(",\n   \"gamma\": ").append(gamma)
          .append(",\n   \"indexOffset\": ").append(indexOffset)
          .append(",\n   \"minIndexableValue\": ").append(m.minIndexableValue())
          .append(",\n   \"maxIndexableValue\": ").append(m.maxIndexableValue())
          .append(",\n   \"cases\": [");
      boolean first = true;
      for (double v : vals) {
        if (v < m.minIndexableValue() || v > m.maxIndexableValue()) continue;
        s.append(first ? "\n" : ",\n").append("    [").append(v).append(", ").append(m.index(v)).append("]");
        first = false;
      }
      s.append("\n   ]\n  }");
    }
    s.append("\n ]\n}\n");
    System.out.print(s);
  }
}
