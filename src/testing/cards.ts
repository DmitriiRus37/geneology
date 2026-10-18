/** Card sizes the way Node measures them, for the tests and tools/metrics.ts. */
import type { Lang } from "../i18n.ts";
import { byChars, cardSizer, type CardSizer } from "../layout/measure.ts";
import { cardText } from "../ui/cards.ts";

const sizers: Partial<Record<Lang, CardSizer>> = {};

export const nodeCards = (lang: Lang = "ru"): CardSizer => (sizers[lang] ??= cardSizer(byChars, cardText(lang)));
