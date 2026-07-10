/* SafeDocPreview — safely renders untrusted repo markdown (no script/HTML
   execution, no javascript: links). Built on the react-markdown + remark-gfm
   stack with NO rehype-raw and the default dangerous-protocol urlTransform.
   Import via `@/components/SafeDocPreview`. */
export { SafeDocPreview } from "./SafeDocPreview";
export type { SafeDocPreviewProps } from "./SafeDocPreview";
