// The FUNNEL_LINER_ADMIN.md §8 billing snapshot example (GV-4).
export function validSnapshot() {
  return {
    sentAt: "2026-11-01T01:00:12+06:00",
    plan: {
      fixedFeePaisa: 290000,
      freeUpTo: 20,
      bands: [
        { upTo: 500, feePaisa: 90000 },
        { upTo: 1000, feePaisa: 200000 },
        { upTo: 1500, feePaisa: 300000 },
        { upTo: 2000, feePaisa: 400000 },
      ],
      stepOrders: 500,
      stepFeePaisa: 100000,
    },
    invoices: [
      {
        number: "FL-2611-0001",
        period: "2610",
        issuedOn: "2026-11-01",
        dueOn: "2026-11-07",
        ordersCreated: 347,
        lastOrderNo: "GV-2610-0347",
        lines: [
          { label: "Fixed fee", amountPaisa: 290000 },
          { label: "Order fee (21–500 orders)", amountPaisa: 90000 },
        ],
        totalPaisa: 380000,
        paidPaisa: 0,
        duePaisa: 380000,
        status: "issued",
      },
    ],
    payTo: { bkash: "01XXXXXXXXX", bank: "…", note: "Use the invoice number as the reference." },
  };
}
