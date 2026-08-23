
import { formatINR, amountInWords, parseToPaise as rupeesToPaise } from "./utils/currency-utils";

/**
 * @deprecated Use src/lib/utils/currency-utils.ts instead.
 * This file is kept for backward compatibility and will be removed in a future update.
 */

export const paiseToRupees = (paise: number): number => paise / 100;

export { formatINR, amountInWords, rupeesToPaise };
