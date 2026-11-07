import { div } from "gpui-kit";

// Draw the generic fallback in the UI; no bundled sprite asset is needed.
export function placeholderSprite(size) {
  return div().size(size).flex().items_center().justify_center()
    .child(div().w(size * .58).h(size * .62).rounded(12)
      .bg("#83c5be").border(3).border_color("#34485a")
      .flex().items_center().justify_center()
      .text_size(size * .24).text_color("#34485a").child("• •"));
}
