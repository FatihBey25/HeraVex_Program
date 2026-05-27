export function TagEditor({
  tags,
  inputValue,
  onInputChange,
  onAdd,
  onRemove,
  addLabel,
  inputPlaceholder,
}: {
  tags: string[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onAdd: () => void | Promise<void>;
  onRemove: (tag: string) => void | Promise<void>;
  addLabel: string;
  inputPlaceholder: string;
}) {
  return (
    <div className="tag-editor">
      <div className="tag-editor-inputs">
        <input
          className="input"
          value={inputValue}
          placeholder={inputPlaceholder}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void onAdd(); }
          }}
        />
        <button className="secondary-button" type="button" onClick={() => void onAdd()}>
          {addLabel}
        </button>
      </div>
      <div className="tag-row">
        {tags.map((tag) => (
          <button
            key={tag}
            type="button"
            className="mini-tag removable-tag"
            onClick={() => void onRemove(tag)}
          >
            {tag} x
          </button>
        ))}
      </div>
    </div>
  );
}
