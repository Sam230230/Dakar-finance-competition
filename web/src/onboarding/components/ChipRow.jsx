export default function ChipRow({ options, value, onSelect }) {
  return (
    <div className="chips">
      {options.map(opt => {
        const v = typeof opt === "object" ? opt.v : opt;
        const label = typeof opt === "object" ? opt.label : `${Number(opt).toLocaleString()}만원`;
        const active = value !== "" && Number(value) === Number(v);
        return (
          <button
            key={v}
            type="button"
            className={"chip" + (active ? " active" : "")}
            onClick={() => onSelect(String(v))}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
