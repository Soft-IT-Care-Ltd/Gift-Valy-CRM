// PHOTO_PRINT.md PP-3 — the card messages `npm run db:seed-card-messages` adds.
// Copied verbatim from the PP-3 list (generated from PHOTO_PRINT.md, so the
// Bangla is byte-for-byte the owner's). {to} / {from} are the name slots.
// The seed only ever ADDS: it matches by text and leaves existing rows — and
// any Admin edit or deactivation of them — untouched.

import type { CardLanguageValue } from "./print-constants";

export interface SeedCardMessage {
  occasion: string;
  language: CardLanguageValue;
  text: string;
}

export const SEED_CARD_MESSAGES: SeedCardMessage[] = [
  // জন্মদিন / Birthday
  { occasion: "জন্মদিন / Birthday", language: "BN", text: "শুভ জন্মদিন! আজকের দিনটা তোমার মতোই সুন্দর হোক। হাসি, ভালোবাসা আর সুখে ভরে উঠুক তোমার প্রতিটা দিন।" }, // 1
  { occasion: "জন্মদিন / Birthday", language: "BN", text: "প্রিয় {to}, শুভ জন্মদিন! দূরে আছি, কিন্তু মনটা সবসময় তোমার কাছেই। আল্লাহ তোমাকে সবসময় ভালো রাখুক। — {from}" }, // 2
  { occasion: "জন্মদিন / Birthday", language: "BN", text: "প্রিয় {to}, আজ পৃথিবীতে তোমার আসার দিন — আমার জীবনের সবচেয়ে সুন্দর দিন। শুভ জন্মদিন, ভালোবাসি অনেক। — তোমার {from}" }, // 3
  { occasion: "জন্মদিন / Birthday", language: "EN", text: "Happy Birthday! May your day be filled with love, laughter and everything that makes you smile." }, // 4
  { occasion: "জন্মদিন / Birthday", language: "EN", text: "Dear {to}, Happy Birthday! Miles apart, but you are always in my heart. — {from}" }, // 5
  { occasion: "জন্মদিন / Birthday", language: "MIXED", text: "Happy Birthday, {to}! তোমার হাসিটাই আমার সবচেয়ে প্রিয় উপহার। Stay happy forever. — {from}" }, // 6
  // বিবাহবার্ষিকী / Anniversary
  { occasion: "বিবাহবার্ষিকী / Anniversary", language: "BN", text: "শুভ বিবাহবার্ষিকী! একসাথে কাটানো প্রতিটা দিন আরও ভালোবাসায় ভরে উঠুক।" }, // 7
  { occasion: "বিবাহবার্ষিকী / Anniversary", language: "BN", text: "প্রিয় {to}, তোমাকে নিয়ে লিখতে গেলে শেষ হবে না। আমাদের ভালোবাসা প্রতিদিন নতুন করে জন্মায়। সারাজীবন এভাবেই পাশে থেকো। শুভ বিবাহবার্ষিকী। — {from}" }, // 8
  { occasion: "বিবাহবার্ষিকী / Anniversary", language: "BN", text: "প্রিয় {to}, দূরে থাকলেও আমাদের বন্ধন একটুও কমেনি। এই বিশেষ দিনে তোমাকে অনেক অনেক ভালোবাসা। শুভ বিবাহবার্ষিকী। — তোমার {from}" }, // 9
  { occasion: "বিবাহবার্ষিকী / Anniversary", language: "EN", text: "Happy Anniversary! Every year with you is a gift. Here's to forever together." }, // 10
  { occasion: "বিবাহবার্ষিকী / Anniversary", language: "MIXED", text: "Happy Anniversary, {to}! তুমি আমার জীবনে এসে জীবনটাকে রাঙিয়ে দিয়েছ। Love you always. — {from}" }, // 11
  // ভালোবাসা / Love
  { occasion: "ভালোবাসা / Love", language: "BN", text: "তুমি আমার জীবনে এসে জীবনটাকে আরও দ্বিগুণ রাঙিয়ে দিয়েছ। আমার জীবনকে রাঙিয়ে দেওয়ার জন্য অনেক ধন্যবাদ।" }, // 12
  { occasion: "ভালোবাসা / Love", language: "BN", text: "প্রিয় {to}, হাজার মাইল দূরে থেকেও প্রতিটা মুহূর্তে তোমাকেই মনে পড়ে। খুব তাড়াতাড়ি দেখা হবে। — {from}" }, // 13
  { occasion: "ভালোবাসা / Love", language: "EN", text: "You are my today and all of my tomorrows. I love you." }, // 14
  { occasion: "ভালোবাসা / Love", language: "EN", text: "Dear {to}, distance means so little when someone means so much. — {from}" }, // 15
  // মিস করছি / Missing you
  { occasion: "মিস করছি / Missing you", language: "BN", text: "দেশ থেকে অনেক দূরে, কিন্তু মন পড়ে আছে তোমাদের কাছেই। খুব মিস করছি।" }, // 16
  { occasion: "মিস করছি / Missing you", language: "BN", text: "প্রিয় {to}, এই ছোট্ট উপহারটা আমার ভালোবাসার একটু ছোঁয়া। খুব মিস করছি তোমাকে। — {from}" }, // 17
  { occasion: "মিস করছি / Missing you", language: "MIXED", text: "Missing you so much, {to}। খুব শিগগিরই দেশে ফিরে তোমার কাছে আসছি। — {from}" }, // 18
  // মা / Mother
  { occasion: "মা / Mother", language: "BN", text: "প্রিয় মা, তোমার দোয়াতেই আমি আজ এতদূর। দূরে আছি, কিন্তু তুমি সবসময় আমার হৃদয়ে। ভালো থেকো মা। — তোমার {from}" }, // 19
  { occasion: "মা / Mother", language: "EN", text: "To the best mom in the world — thank you for everything. Love you, Ma." }, // 20
  // ঈদ / Eid
  { occasion: "ঈদ / Eid", language: "BN", text: "ঈদ মোবারক! ঈদের আনন্দ ছড়িয়ে পড়ুক তোমার জীবনের প্রতিটা দিনে।" }, // 21
  { occasion: "ঈদ / Eid", language: "BN", text: "প্রিয় {to}, ঈদ মোবারক! এবারের ঈদে কাছে থাকতে পারলাম না, তাই ভালোবাসাটুকু পাঠিয়ে দিলাম। — {from}" }, // 22
  { occasion: "ঈদ / Eid", language: "EN", text: "Eid Mubarak! Wishing you joy, peace and endless blessings." }, // 23
  // দুঃখিত / Sorry
  { occasion: "দুঃখিত / Sorry", language: "BN", text: "প্রিয় {to}, ভুল হয়ে গেছে, ক্ষমা করে দিও। তোমার রাগ ভাঙাতে এই ছোট্ট উপহার। — {from}" }, // 24
  { occasion: "দুঃখিত / Sorry", language: "EN", text: "I'm sorry. You mean the world to me — please forgive me." }, // 25
  // অভিনন্দন / Congratulations
  { occasion: "অভিনন্দন / Congratulations", language: "BN", text: "অভিনন্দন! তোমার এই সাফল্যে আমরা সবাই অনেক খুশি। সামনে আরও এগিয়ে যাও।" }, // 26
  { occasion: "অভিনন্দন / Congratulations", language: "EN", text: "Congratulations, {to}! So proud of you. — {from}" }, // 27
];
