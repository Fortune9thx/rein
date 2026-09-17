const DEFAULT_WORDS = ["STAY ON MANDATE", "REIN", "HALT ON VIOLATION"];

export function TapeBand({
  words = DEFAULT_WORDS,
  diagonal = false,
}: {
  words?: string[];
  diagonal?: boolean;
}) {
  const repeated = [...words, ...words];
  return (
    <div className={`tape-band ${diagonal ? "tape-band--diagonal" : ""}`}>
      <div className="tape-band__track">
        {[...repeated, ...repeated].map((w, i) => (
          <span key={i}>{w} ▲</span>
        ))}
      </div>
    </div>
  );
}
