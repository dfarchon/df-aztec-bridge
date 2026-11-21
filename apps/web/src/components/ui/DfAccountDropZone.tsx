import { useRef, useState, type DragEvent } from "react";

export function DfAccountDropZone({ disabled, label, onChoose, onFiles }: {
  disabled: boolean;
  label: string;
  onChoose: () => void;
  onFiles: (files: FileList) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");
  return (
    <div
      className={`df-account-drop-wrap${dragging && !disabled ? " is-dragging" : ""}${disabled ? " is-disabled" : ""}`}
      onDragEnter={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        dragDepth.current += 1;
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (!disabled && event.dataTransfer.files.length) onFiles(event.dataTransfer.files);
      }}
    >
      <button type="button" className="df-account-drop" disabled={disabled} onClick={onChoose}>
        <span className="df-account-drop-icon" aria-hidden="true">↑</span>
        <span className="df-account-drop-copy">
          <strong>{dragging && !disabled ? "Drop your DF account file" : label}</strong>
          <span>Drag and drop a JSON file here, or click to choose</span>
        </span>
      </button>
    </div>
  );
}
