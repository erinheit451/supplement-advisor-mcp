// Buy-link resolution for the bundled (offline) catalog path.
//
// Mirrors site/src/utils/buyRedirect.mjs on verifiedsupplementdata.com. When the
// server is running against the LIVE feed it does not need this — the feed's urls
// are already resolved server-side. This exists so the offline fallback path can
// never hand an agent a delisted product either.

export const AFFILIATE_TAG = "verifiedsupp2-20";

export interface CatalogProduct {
  slug: string;
  name: string;
  amazonAsin?: string | null;
  availability?: string;
  fallbackSlug?: string | null;
}

export interface ResolvedBuy {
  url: string;
  cartUrl: string | null;
  usedFallback: boolean;
  substituteName: string | null;
}

/**
 * Resolve where a buyer should actually be sent.
 * - product available (or never checked) -> its own ASIN
 * - unavailable with a pre-verified same-category fallback -> the fallback's ASIN
 * - otherwise -> a tagged Amazon search, never a dead /dp/ page
 */
export function resolveBuy(
  p: CatalogProduct,
  bySlug: Map<string, CatalogProduct>,
  source = "mcp",
): ResolvedBuy {
  const unavailable = !!p.availability && p.availability !== "ok";
  let asin = unavailable ? null : p.amazonAsin || null;
  let usedFallback = false;
  let substituteName: string | null = null;

  if (unavailable && p.fallbackSlug) {
    const fb = bySlug.get(p.fallbackSlug);
    if (fb?.amazonAsin) {
      asin = fb.amazonAsin;
      usedFallback = true;
      substituteName = fb.name;
    }
  }

  if (!asin) {
    return {
      url: `https://www.amazon.com/s?k=${encodeURIComponent(p.name)}&tag=${AFFILIATE_TAG}&ascsubtag=${p.slug}__${source}`,
      cartUrl: null, // no ASIN -> no add-to-cart
      usedFallback: false,
      substituteName: null,
    };
  }

  return {
    url: `https://www.amazon.com/dp/${asin}?tag=${AFFILIATE_TAG}&ascsubtag=${p.slug}__${source}`,
    // Add-to-Cart extends the affiliate cookie from 24 hours to 90 days.
    cartUrl: `https://www.amazon.com/gp/aws/cart/add.html?AssociateTag=${AFFILIATE_TAG}&ASIN.1=${asin}&Quantity.1=1`,
    usedFallback,
    substituteName,
  };
}
