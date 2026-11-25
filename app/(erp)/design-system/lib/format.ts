// Formatters used across the Soft IT Care design system.
// Money uses Indian-style grouping with a "Tk" suffix; Bangla numerals via `bn`.

export const FMT = {
  // "1,24,500 Tk" — symbol AFTER digits, Indian grouping
  money: (n: number): string => {
    const s = Math.round(n).toString();
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3);
    const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    return (rest ? grouped + "," + last3 : last3) + " Tk";
  },
  // "১,২৪,৫০০ ৳"
  moneyBn: (n: number): string => {
    const en = FMT.money(n).replace(" Tk", "");
    return en.replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]) + " ৳";
  },
  // "20 Apr, 2026"
  date: (d: Date): string => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${d.getDate()} ${months[d.getMonth()]}, ${d.getFullYear()}`;
  },
  // "01712345678" — 11 digits, no spaces (national = "1712345678")
  phone: (national: string): string => "0" + national,
  phoneMasked: (national: string): string => "0" + national.slice(0, 6) + "•••••",
  // English digits → Bangla digits
  bn: (v: string | number): string =>
    String(v).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]),
  // Short lakh: "28.4L Tk"
  lakh: (n: number): string => {
    const l = n / 100000;
    return (l >= 10 ? l.toFixed(1).replace(/\.0$/, "") : l.toFixed(1)) + "L Tk";
  },
};

export const banglaNumerals = FMT.bn;
