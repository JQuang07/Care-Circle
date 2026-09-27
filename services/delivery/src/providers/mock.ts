import type { Kind } from "../types.js";
import type { Priced } from "../match.js";
import { ProviderError, type CartResult, type Provider, type Store, type TrackStatus } from "./provider.js";

const $ = (d: number) => Math.round(d * 100);

// What the grocery store hands you when Rose just says "milk" or "bread".
const STAPLES = new Set(["Whole Milk, 1 gal", "Whole Wheat Bread"]);

const GROCERY: Priced[] = [
  ["Whole Milk, 1 gal", 4.29], ["2% Reduced Fat Milk, 1 gal", 4.19], ["Oat Milk, 64 oz", 4.99],
  ["Whole Wheat Bread", 3.49], ["Seeded Multigrain Bread", 4.29], ["White Sandwich Bread", 2.99],
  ["Large Eggs, 12 ct", 3.79], ["Bananas", 1.89], ["Honeycrisp Apples, 3 lb", 5.99],
  ["Roma Tomatoes, 1 lb", 1.99], ["Chicken Thighs, 1.5 lb", 6.49], ["Ground Beef, 1 lb", 5.99],
  ["Old Fashioned Oatmeal", 3.99], ["Black Tea, 100 ct", 5.49], ["Ground Coffee, 12 oz", 7.99],
  ["Butter, 1 lb", 4.99], ["Cheddar Cheese, 8 oz", 3.49], ["Plain Yogurt, 32 oz", 3.99],
  ["Orange Juice, 52 oz", 4.49], ["Chicken Noodle Soup", 1.99], ["Saltine Crackers", 2.79],
  ["Dish Soap", 3.29], ["Paper Towels, 6 roll", 8.99], ["Toilet Paper, 12 roll", 9.99],
  ["Russet Potatoes, 5 lb", 4.49], ["Yellow Onions, 3 lb", 3.29], ["Carrots, 2 lb", 2.49],
  ["Spinach, 10 oz", 3.49], ["Frozen Peas", 1.99], ["Rice, 2 lb", 2.99],
  ["Spaghetti, 1 lb", 1.49], ["Marinara Sauce", 2.99], ["Peanut Butter", 3.49],
  ["Strawberry Jam", 3.29], ["Honey", 5.99], ["Sugar, 4 lb", 3.49],
  ["All-Purpose Flour, 5 lb", 3.99], ["Apple Gift Card $50", 50], ["Target Gift Card $100", 100],
].map(([name, price]) => ({ name: name as string, priceCents: $(price as number), ...(STAPLES.has(name as string) && { staple: true }) }));

const RESTAURANTS: { store: Store; menu: Priced[] }[] = [
  { store: { id: "mock_harvest_table", name: "Harvest Table (demo)" },
    menu: [["Slow-Braised Pot Roast Plate", 18.5], ["Braised Short Rib", 22], ["Pot Roast Sandwich", 13.5],
      ["Garden Salad", 8], ["Mashed Potatoes", 5], ["Apple Pie Slice", 6.5]]
      .map(([n, p]) => ({ name: n as string, priceCents: $(p as number) })) },
  { store: { id: "mock_golden_wok", name: "Golden Wok (demo)" },
    menu: [["Beef Noodle Soup", 14], ["Chicken Fried Rice", 11], ["Scallion Pancake", 6]]
      .map(([n, p]) => ({ name: n as string, priceCents: $(p as number) })) },
];

export class MockProvider implements Provider {
  readonly name = "mock" as const;
  private cart: { store: Store; lines: { name: string; qty: number; priceCents: number }[] } | null = null;
  private placed = new Map<string, { at: number; forced?: TrackStatus }>();

  constructor(private now: () => number = Date.now) {}

  estimateFeesCents(_subtotal: number) { return 299; } // the mock's flat delivery fee

  async status() { return { connected: true, loggedIn: true, detail: "mock provider (no DoorDash)" }; }

  async findStore(kind: Kind, hint?: string): Promise<Store> {
    if (kind === "grocery") return { id: "mock_freshmart", name: "Kroger (demo)" };
    const h = (hint ?? "").toLowerCase();
    return (RESTAURANTS.find((r) => h && r.store.name.toLowerCase().includes(h)) ?? RESTAURANTS[0]!).store;
  }

  async catalog(store: Store): Promise<Priced[]> {
    if (store.id === "mock_freshmart") return GROCERY;
    const r = RESTAURANTS.find((x) => x.store.id === store.id);
    if (!r) throw new ProviderError("NO_STORE", `Unknown mock store ${store.id}`);
    return r.menu;
  }

  async buildCart(store: Store, lines: { name: string; qty: number }[]): Promise<CartResult> {
    const menu = await this.catalog(store);
    const priced = lines.map((l) => {
      const m = menu.find((x) => x.name === l.name);
      if (!m) throw new ProviderError("ITEM_UNAVAILABLE", `${l.name} is not on ${store.name}`);
      return { ...l, priceCents: m.priceCents };
    });
    this.cart = { store, lines: priced };
    const subtotalCents = priced.reduce((s, l) => s + l.priceCents * l.qty, 0);
    return { subtotalCents, totalCents: subtotalCents + 299, itemNames: priced.map((l) => l.name) }; // + mock delivery fee
  }

  async preview(): Promise<{ totalCents?: number; etaText?: string }> {
    if (!this.cart) throw new ProviderError("EMPTY_CART", "Nothing in the cart");
    const sub = this.cart.lines.reduce((s, l) => s + l.priceCents * l.qty, 0);
    return { totalCents: sub + 299, etaText: "25-35 min" };
  }

  async checkout() {
    if (!this.cart) throw new ProviderError("EMPTY_CART", "Nothing in the cart");
    const id = `mock_dd_${Math.random().toString(36).slice(2, 10)}`;
    this.placed.set(id, { at: this.now() });
    this.cart = null;
    return { externalOrderId: id, etaText: "25-35 min" };
  }

  /** Mock timeline: placed → picked_up after 10 min → delivered after 25 min (or forced by /demo/advance). */
  async track(id: string) {
    const p = this.placed.get(id);
    if (!p) return { status: "placed" as const };
    if (p.forced) return { status: p.forced };
    const mins = (this.now() - p.at) / 60_000;
    return { status: (mins >= 25 ? "delivered" : mins >= 10 ? "picked_up" : "placed") as TrackStatus, etaText: "25-35 min" };
  }

  force(id: string, status: TrackStatus) {
    this.placed.set(id, { at: this.placed.get(id)?.at ?? this.now(), forced: status });
  }
}
