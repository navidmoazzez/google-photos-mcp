/** Every tool, in the order they appear in the README. */

import type { AnyToolSpec } from "./kit.js";

import { pickerTools } from "./picker.js";
import { albumTools } from "./albums.js";
import { mediaTools } from "./media.js";
import { uploadTools } from "./uploads.js";
import { metaTools } from "./meta.js";

export const ALL_TOOLS: AnyToolSpec[] = [
  ...pickerTools,
  ...albumTools,
  ...mediaTools,
  ...uploadTools,
  ...metaTools,
];
