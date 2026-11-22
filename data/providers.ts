// Public listed prices, Bengaluru, as of 22 Nov 2026.

export type Mode = "lab visit" | "home collection";
export type Category = "hero" | "advanced" | "standard" | "genetic";
export type Tag =
  | "longevity" | "fullbody" | "genetic" | "gut" | "stamina"
  | "heart" | "metabolism" | "hormones" | "thyroid" | "bone" | "vitamins"
  | "cancer" | "fitness" | "general";

export interface Provider {
  id: string;
  name: string;
  product: string;
  covers: string;
  /** Individual test keys, used to avoid paying twice for the same test. */
  tests: string[];
  priceInr: number;
  mode: Mode;
  location: string;
  bookingUrl: string;
  contactUrl: string;
  category: Category;
  tags: Tag[];
  cityConfirmed: boolean;
  needsPrescription: boolean;
  /** Stored Google rating, used when a live refresh fails. */
  googleRating?: { stars: number; reviews: number; asOf: string };
  /** Home-collection service with no Google Maps listing of its own. */
  homeService?: boolean;
}

export const PRICES_AS_OF = "2026-11-22";
export const PRICES_AS_OF_LABEL = "listed 22 Nov 2026";
export const RATINGS_AS_OF_LABEL = "Google · 22 Nov";
const rated = (stars: number, reviews: number) => ({ stars, reviews, asOf: "2026-11-22" });

export const providers: Provider[] = [
  {
    id: "cent-fullbody",
    name: "Cent Health",
    product: "Full-body check",
    covers: "Full-body MRI, low-dose CT heart calcium score, DEXA, 100+ biomarkers",
    tests: ["mri-full-body", "ct-calcium-score", "dexa", "blood-core", "lipid-heart", "cancer-markers"],
    priceInr: 23500,
    mode: "lab visit",
    location: "Koramangala, Bengaluru",
    bookingUrl: "https://www.cent.health/product",
    contactUrl: "https://www.cent.health/",
    category: "hero",
    tags: ["heart", "longevity", "fullbody", "bone", "cancer"],
    cityConfirmed: true,
    needsPrescription: false,
    googleRating: rated(4.5, 546),
  },
  {
    id: "cent-genetic",
    name: "Cent Health",
    product: "Genetic Health Module",
    covers: "Genetic risk screening module",
    tests: ["genetic-panel"],
    priceInr: 17500,
    mode: "lab visit",
    location: "Koramangala, Bengaluru",
    bookingUrl: "https://www.cent.health/product",
    contactUrl: "https://www.cent.health/",
    category: "genetic",
    tags: ["genetic"],
    cityConfirmed: true,
    needsPrescription: true,
    googleRating: rated(4.5, 546),
  },
  {
    id: "nura-ai",
    name: "Nura",
    product: "AI health screening",
    covers: "Low-dose CT, DEXA, AI cancer screening, blood tests",
    tests: ["low-dose-ct-chest", "dexa", "cancer-screening", "blood-core"],
    priceInr: 20000,
    mode: "lab visit",
    location: "Indiranagar, Bengaluru",
    bookingUrl: "https://bengaluru.nura.in/",
    contactUrl: "https://bengaluru.nura.in/",
    category: "hero",
    tags: ["fullbody", "heart", "metabolism", "bone", "cancer"],
    cityConfirmed: true,
    needsPrescription: false,
    googleRating: rated(4.7, 929),
  },
  {
    id: "ultrahuman-pro",
    name: "Ultrahuman",
    product: "Performance Lab Pro",
    covers: "Advanced blood panel, VO2 max, DEXA, lung, hearing and eye tests",
    tests: ["blood-advanced", "vo2max", "dexa", "lung-function", "hearing", "eye"],
    priceInr: 29999,
    mode: "lab visit",
    location: "Domlur, Bengaluru",
    bookingUrl: "https://www.ultrahuman.com/in/performance-lab/buy/",
    contactUrl: "https://www.ultrahuman.com/in/performance-lab/",
    category: "hero",
    tags: ["longevity", "stamina", "bone", "fitness"],
    cityConfirmed: true,
    needsPrescription: false,
    googleRating: rated(4.6, 123),
  },
  {
    id: "ultrahuman-basic",
    name: "Ultrahuman",
    product: "Performance Lab Basic",
    covers: "Advanced blood panel, VO2 max",
    tests: ["blood-advanced", "vo2max"],
    priceInr: 9999,
    mode: "lab visit",
    location: "Domlur, Bengaluru",
    bookingUrl: "https://www.ultrahuman.com/in/performance-lab/buy/",
    contactUrl: "https://www.ultrahuman.com/in/performance-lab/",
    category: "advanced",
    tags: ["longevity", "stamina"],
    cityConfirmed: true,
    needsPrescription: false,
    googleRating: rated(4.6, 123),
  },
  {
    id: "deep-holistics",
    name: "Deep Holistics",
    product: "Baseline",
    covers: "100+ biomarkers incl. hormones, gut and metabolic markers",
    tests: ["hormone-panel", "gut-markers", "metabolic-advanced"],
    priceInr: 9999,
    mode: "home collection",
    location: "Home collection, Bengaluru",
    bookingUrl: "https://deepholistics.com/dh-baseline-landing",
    contactUrl: "https://deepholistics.com/",
    category: "advanced",
    tags: ["gut", "hormones", "metabolism", "thyroid", "vitamins"],
    cityConfirmed: true,
    needsPrescription: false,
    homeService: true,
  },
  {
    id: "tata-1mg-gold",
    name: "Tata 1mg",
    product: "Comprehensive Gold full-body (86 tests)",
    covers: "86 tests: blood count, sugar, lipids, liver, kidney, thyroid, vitamins",
    tests: ["blood-core"],
    priceInr: 2499,
    mode: "home collection",
    location: "Home collection, Bengaluru",
    bookingUrl: "https://www.1mg.com/labs/test/comprehensive-gold-full-body-checkup-with-smart-report-2763",
    contactUrl: "https://www.1mg.com/labs",
    category: "standard",
    tags: ["general", "thyroid", "vitamins", "metabolism"],
    cityConfirmed: true,
    needsPrescription: false,
    googleRating: rated(4.5, 1300),
  },
  {
    id: "supprx-ultra",
    name: "Supp[Rx]",
    product: "Ultra (85+ parameters)",
    covers: "85+ blood parameters",
    tests: ["blood-core", "metabolic-advanced"],
    priceInr: 5999,
    mode: "home collection",
    location: "City not confirmed",
    bookingUrl: "https://www.supprx.app/pricing",
    contactUrl: "https://www.supprx.app/",
    category: "advanced",
    tags: ["metabolism", "vitamins"],
    cityConfirmed: false,
    needsPrescription: false,
  },
];

export const providerById = (id: string) => providers.find((p) => p.id === id);
