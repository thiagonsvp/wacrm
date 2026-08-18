import { describe, expect, it } from "vitest";
import {
  cac,
  closeRate,
  cpl,
  ctr,
  groupByCampaign,
  groupByCreative,
  indexByAd,
  mediaTotals,
  qualificationRate,
  reachedNegotiating,
  reachedQualified,
  roas,
  spendByDay,
  toAdMedia,
} from "./merge";
import { emptyCounts, type AdFunnel, type AdMedia } from "./types";

// A Windsor row as it actually arrives: flat, string-y, one per day×ad.
function windsorRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    date: "2026-08-10",
    campaign: "[SM] [Vendas] [WHATSAPP] [ABO]",
    campaign_id: "c-1",
    adset_name: "Conjunto A",
    ad_id: "120253545962250045",
    ad_name: "Iphone 14 Plus",
    spend: "10.5",
    impressions: "1000",
    reach: "800",
    clicks: "25",
    image_url: "https://cdn.example/creative.jpg",
    ...over,
  };
}

function funnel(over: Partial<AdFunnel> = {}): AdFunnel {
  return {
    adId: "120253545962250045",
    headline: "Converse conosco",
    imageUrl: null,
    ...emptyCounts(),
    ...over,
  };
}

describe("toAdMedia", () => {
  it("coerces the string numerics Windsor sends", () => {
    const row = toAdMedia(windsorRow());
    expect(row.spend).toBe(10.5);
    expect(row.impressions).toBe(1000);
    expect(row.clicks).toBe(25);
    expect(row.adId).toBe("120253545962250045");
  });

  it("survives missing and non-numeric fields instead of producing NaN", () => {
    const row = toAdMedia({ campaign: "X", spend: "n/a" });
    expect(row.spend).toBe(0);
    expect(row.impressions).toBe(0);
    expect(row.adId).toBe("");
    expect(row.imageUrl).toBeNull();
  });

  it("pulls the day out of a timestamped date", () => {
    expect(toAdMedia(windsorRow({ date: "2026-08-10T00:00:00Z" })).date).toBe("2026-08-10");
  });
});

describe("indexByAd", () => {
  it("sums the daily rows of one ad into a single entry", () => {
    const rows = [
      toAdMedia(windsorRow({ date: "2026-08-10", spend: 10, clicks: 5 })),
      toAdMedia(windsorRow({ date: "2026-08-11", spend: 15, clicks: 7 })),
    ];
    const byAd = indexByAd(rows);
    expect(byAd.size).toBe(1);
    expect(byAd.get("120253545962250045")?.spend).toBe(25);
    expect(byAd.get("120253545962250045")?.clicks).toBe(12);
  });

  it("keeps the first non-empty name when a later row comes back blank", () => {
    const rows = [
      toAdMedia(windsorRow({ ad_name: "Iphone 14 Plus" })),
      toAdMedia(windsorRow({ date: "2026-08-11", ad_name: "" })),
    ];
    expect(indexByAd(rows).get("120253545962250045")?.adName).toBe("Iphone 14 Plus");
  });

  it("ignores rows with no ad id rather than bucketing them together", () => {
    expect(indexByAd([toAdMedia(windsorRow({ ad_id: "" }))]).size).toBe(0);
  });
});

describe("spendByDay", () => {
  it("adds up every ad's spend per calendar day", () => {
    const rows: AdMedia[] = [
      toAdMedia(windsorRow({ date: "2026-08-10", spend: 10 })),
      toAdMedia(windsorRow({ date: "2026-08-10", ad_id: "b", spend: 4 })),
      toAdMedia(windsorRow({ date: "2026-08-11", spend: 7 })),
    ];
    const byDay = spendByDay(rows);
    expect(byDay.get("2026-08-10")).toBe(14);
    expect(byDay.get("2026-08-11")).toBe(7);
  });
});

describe("groupByCampaign", () => {
  it("attaches leads to a campaign through the AD ID, not the headline", () => {
    // The regression this whole report exists to fix: the CRM's
    // `acquisition_campaign` is the ad headline ("Converse conosco"),
    // which never equals the Marketing-API campaign name.
    const media = [toAdMedia(windsorRow())];
    const rows = groupByCampaign(media, [
      funnel({ leads: 12, qualified: 5, negotiating: 3, won: 2, revenue: 15000 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("[SM] [Vendas] [WHATSAPP] [ABO]");
    expect(rows[0].leads).toBe(12);
    expect(rows[0].won).toBe(2);
    expect(rows[0].revenue).toBe(15000);
  });

  it("merges every ad of a campaign into one row", () => {
    const media = [
      toAdMedia(windsorRow({ ad_id: "ad-1", spend: 10 })),
      toAdMedia(windsorRow({ ad_id: "ad-2", spend: 30 })),
    ];
    const rows = groupByCampaign(media, [
      funnel({ adId: "ad-1", leads: 4, won: 1 }),
      funnel({ adId: "ad-2", leads: 6, won: 2 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].spend).toBe(40);
    expect(rows[0].leads).toBe(10);
    expect(rows[0].won).toBe(3);
  });

  it("parks leads from an unknown ad id in a flagged row instead of dropping them", () => {
    const rows = groupByCampaign(
      [toAdMedia(windsorRow({ ad_id: "known" }))],
      [funnel({ adId: "never-seen", leads: 9, won: 1 })],
    );
    const orphan = rows.find((r) => !r.matched);
    expect(orphan).toBeDefined();
    expect(orphan?.leads).toBe(9);
    // and it must not inflate the real campaign's numbers
    expect(rows.find((r) => r.matched)?.leads).toBe(0);
  });

  it("keeps a campaign that spent but produced no lead", () => {
    const rows = groupByCampaign([toAdMedia(windsorRow({ spend: 99 }))], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].spend).toBe(99);
    expect(rows[0].leads).toBe(0);
  });

  it("sorts by spend first", () => {
    const media = [
      toAdMedia(windsorRow({ campaign_id: "c-low", campaign: "Baixa", spend: 5 })),
      toAdMedia(windsorRow({ campaign_id: "c-high", campaign: "Alta", spend: 500 })),
    ];
    expect(groupByCampaign(media, []).map((r) => r.name)).toEqual(["Alta", "Baixa"]);
  });
});

describe("groupByCreative", () => {
  it("gives one row per ad and carries the Windsor creative image", () => {
    const rows = groupByCreative(
      [toAdMedia(windsorRow())],
      [funnel({ leads: 3, imageUrl: "https://cdn.example/whatsapp-thumb.jpg" })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Iphone 14 Plus");
    expect(rows[0].imageUrl).toBe("https://cdn.example/creative.jpg");
    expect(rows[0].leads).toBe(3);
  });

  it("falls back to the WhatsApp headline when Windsor has no such ad", () => {
    const rows = groupByCreative([], [funnel({ adId: "orphan", headline: "Oferta iPhone", leads: 2 })]);
    expect(rows[0].name).toBe("Oferta iPhone");
    expect(rows[0].matched).toBe(false);
    expect(rows[0].leads).toBe(2);
  });
});

describe("cumulative funnel counters", () => {
  // The per-stage counters are a snapshot of the board, so anyone who
  // already bought is no longer sitting in "qualified". Rates have to
  // add the downstream stages back in or every campaign that actually
  // converts looks worse than one that stalls.
  const counts = {
    ...emptyCounts(),
    leads: 100,
    noDeal: 40,
    qualified: 30,
    negotiating: 20,
    won: 6,
    lost: 4,
  };

  it("counts everyone who reached qualification, including those past it", () => {
    expect(reachedQualified(counts)).toBe(60);
  });

  it("counts everyone who reached a negotiation, including the closed wins", () => {
    expect(reachedNegotiating(counts)).toBe(26);
  });

  it("derives the funnel rates from the cumulative counts", () => {
    expect(qualificationRate(counts)).toBeCloseTo(0.6);
    expect(closeRate(counts)).toBeCloseTo(6 / 26);
  });
});

describe("rates with an empty denominator", () => {
  // A rate over zero is unknown, not zero — returning 0 would render a
  // confident "0%" / "R$ 0,00" for something never measured.
  const zero = { ...emptyCounts(), spend: 0, clicks: 0, impressions: 0, revenue: 0 };

  it("returns null instead of zero or Infinity", () => {
    expect(ctr(zero)).toBeNull();
    expect(cpl(zero)).toBeNull();
    expect(cac(zero)).toBeNull();
    expect(roas(zero)).toBeNull();
    expect(qualificationRate(zero)).toBeNull();
  });

  it("still computes when the denominator is present", () => {
    expect(ctr({ clicks: 25, impressions: 1000 })).toBeCloseTo(0.025);
    expect(cpl({ spend: 100, leads: 8 })).toBeCloseTo(12.5);
    expect(roas({ revenue: 3000, spend: 1000 })).toBe(3);
  });
});

describe("mediaTotals", () => {
  it("adds up every row, including ones with no ad id", () => {
    const totals = mediaTotals([
      toAdMedia(windsorRow({ spend: 10, impressions: 100, clicks: 3, reach: 90 })),
      toAdMedia(windsorRow({ ad_id: "", spend: 5, impressions: 50, clicks: 1, reach: 40 })),
    ]);
    expect(totals).toEqual({ spend: 15, impressions: 150, clicks: 4, reach: 130 });
  });
});
