import type { PartDef } from './types';

/** Where a part with no category, or one the builder does not know, is listed. */
export const OTHER_CATEGORY = 'Other';

/** The builder's drawer sections, in the order shown (M16). A part names one in its definition (`category`). */
export const PART_CATEGORIES: readonly string[] = ['Structure', 'Energy', 'Movement', 'Joints', 'Sensing', 'Making', 'Tools', OTHER_CATEGORY];

/** The drawer section a part goes in: its `category` when it is one of `PART_CATEGORIES`, else "Other". */
export function categoryOf(def: Pick<PartDef, 'category'>): string {
  return def.category !== undefined && PART_CATEGORIES.includes(def.category) ? def.category : OTHER_CATEGORY;
}
