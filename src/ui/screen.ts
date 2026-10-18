/**
 * Facts about the screen that the stylesheet knows too. src/ui/css.test.ts holds the
 * two copies together.
 */

/** The phone: a narrow screen, or a short one held sideways. */
export const NARROW = "(max-width: 860px), (max-height: 500px) and (max-width: 1000px)";

/** On a phone: the top of the canvas taken by the bar over it, with the gap below — the
    same strip the sheet's ruler measures in the stylesheet. */
export const BAR = 76;
