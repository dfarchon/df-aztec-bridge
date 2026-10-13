/** Static label. Hover no longer scrambles or focuses the text. */
export function DecodeText(props: { children: string }) {
  return <span className="decode-text">{props.children}</span>;
}
